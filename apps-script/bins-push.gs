/**
 * Pushes the council bin collection dates to Our Home. Separate from the weekly bin email:
 * this file never sends email and does not change the existing functions.
 *
 * Setup (3 steps):
 *  1. Add this file to the same Apps Script project as the bin reminder (it calls
 *     fetchCollectionPage() and thisWeekCollections()).
 *  2. Project Settings > Script properties: add OUR_HOME_BINS_SECRET = the shared secret
 *     (the same value stored in Our Home as private.integration_secrets name 'bins').
 *  3. Run installBinsPushTrigger() once (approve permissions), then pushBinsToOurHome() once to test.
 */

var OUR_HOME_BINS_URL = 'https://your-domain.example/api/integrations/bins';

function pushBinsToOurHome() {
  var secret = PropertiesService.getScriptProperties().getProperty('OUR_HOME_BINS_SECRET');
  if (!secret) {
    console.error('OUR_HOME_BINS_SECRET is not set in Script Properties.');
    return;
  }
  var html = fetchCollectionPage();
  var rows = thisWeekCollections(html).all;
  var body = JSON.stringify({
    collections: rows.map(function (r) { return { date: r.ymd, bin: r.name }; }),
  });
  var ts = String(Math.floor(Date.now() / 1000));
  var bytes = Utilities.computeHmacSha256Signature(ts + '.' + body, secret);
  var sig = bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  var res = UrlFetchApp.fetch(OUR_HOME_BINS_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: body,
    headers: { 'X-OurHome-Timestamp': ts, 'X-OurHome-Signature': sig },
    muteHttpExceptions: true,
  });
  console.log('Our Home bins push: HTTP ' + res.getResponseCode() + ', ' + rows.length + ' collections');
}

/** Daily 06:00 Europe/London. Only removes triggers for pushBinsToOurHome. */
function installBinsPushTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pushBinsToOurHome') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pushBinsToOurHome')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .inTimezone('Europe/London')
    .create();
}
