/**
 * Our Home - Gmail "awaiting replies" relay. Install once per person, in their OWN Gmail.
 *
 * What it sends (metadata only, never bodies, never addresses or names):
 *   hashed thread id, subject (first 150 chars), counterpart domain, last message time,
 *   who sent the last message ('me' or 'them') and whether you applied the label.
 * It is read-only: it never sends, labels, archives or deletes mail.
 *
 * SETUP (3 steps)
 *  1. script.google.com > New project > paste this file. In Project Settings > Script Properties add:
 *       OUR_HOME_GMAIL_SECRET = the shared secret Alex gives you (32+ characters)
 *       OUR_HOME_MEMBER       = your Our Home display name (e.g. Alex)
 *       OUR_HOME_SALT         = any long random text you make up (keeps Gmail ids unreadable)
 *     In Project Settings tick "Show appsscript.json" and set oauthScopes to exactly:
 *       ["https://www.googleapis.com/auth/gmail.readonly",
 *        "https://www.googleapis.com/auth/script.external_request"]
 *  2. Run installTrigger() once and approve the permissions (read mail, call external URL).
 *  3. Optional: in Gmail create the label "Our Home/Awaiting" and apply it to any thread you
 *     are waiting on. Run syncAwaitingThreads() once by hand to test.
 */

var OUR_HOME_ENDPOINT = 'https://your-domain.example/api/integrations/gmail';
var OUR_HOME_LABEL = 'Our Home/Awaiting';
var OUR_HOME_MAX_THREADS = 50;
var OUR_HOME_QUIET_DAYS = 3;
var OUR_HOME_WINDOW_DAYS = 60;

/** Run once. Replaces any existing sync trigger with one every 30 minutes. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncAwaitingThreads') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncAwaitingThreads').timeBased().everyMinutes(30).create();
}

function ourHomeHex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function ourHomeSha256_(text) {
  return ourHomeHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

/** The domain part of "Name <a@b.com>" or "a@b.com", lowercased; null if not an address. */
function ourHomeDomain_(field) {
  var m = /([A-Za-z0-9._%+'-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(field || '');
  if (!m) return null;
  var d = m[2].toLowerCase().replace(/^\.+|\.+$/g, '');
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d) && d.length <= 120 ? d : null;
}

function ourHomeIso_(date) {
  return Utilities.formatDate(date, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

/** Builds the metadata record for one thread, or null when it should be skipped. */
function ourHomeRecord_(thread, salt, myEmails, labelFlag) {
  var msgs = thread.getMessages();
  if (!msgs.length) return null;
  var last = msgs[msgs.length - 1];
  var lastFromField = last.getFrom();
  var lastFromDomain = ourHomeDomain_(lastFromField);
  var lastAddr = (/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+/.exec(lastFromField || '') || [''])[0].toLowerCase();
  var fromMe = myEmails.indexOf(lastAddr) !== -1;

  var myDomains = myEmails.map(function (e) { return e.split('@')[1]; });
  var counterpart = null;
  if (fromMe) {
    counterpart = ourHomeDomain_(last.getTo());
  } else {
    counterpart = lastFromDomain;
  }
  if (!counterpart) return null;
  if (myDomains.indexOf(counterpart) !== -1 && !labelFlag) return null; // internal mail
  return {
    thread_hash: ourHomeSha256_(thread.getId() + salt),
    subject: (thread.getFirstMessageSubject() || '').substring(0, 150),
    counterpart_domain: counterpart,
    last_message_at: ourHomeIso_(last.getDate()),
    last_from: fromMe ? 'me' : 'them',
    label_flag: !!labelFlag
  };
}

function syncAwaitingThreads() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('OUR_HOME_GMAIL_SECRET');
  var member = props.getProperty('OUR_HOME_MEMBER');
  var salt = props.getProperty('OUR_HOME_SALT');
  if (!secret || !member || !salt) throw new Error('Set OUR_HOME_GMAIL_SECRET, OUR_HOME_MEMBER and OUR_HOME_SALT in Script Properties.');

  var me = Session.getEffectiveUser().getEmail().toLowerCase();
  var myEmails = [me];
  try {
    Gmail.Users.Settings.SendAs.list('me').sendAs.forEach(function (s) { myEmails.push(String(s.sendAsEmail).toLowerCase()); });
  } catch (e) { /* advanced Gmail service not enabled: primary address only */ }

  var records = {};
  var count = 0;
  function add(thread, labelFlag) {
    if (count >= OUR_HOME_MAX_THREADS) return;
    var rec;
    try { rec = ourHomeRecord_(thread, salt, myEmails, labelFlag); } catch (e) { return; }
    if (!rec) return;
    if (records[rec.thread_hash]) { records[rec.thread_hash].label_flag = records[rec.thread_hash].label_flag || rec.label_flag; return; }
    records[rec.thread_hash] = rec;
    count++;
  }

  var label = GmailApp.getUserLabelByName(OUR_HOME_LABEL);
  if (label) {
    label.getThreads(0, OUR_HOME_MAX_THREADS).forEach(function (t) { add(t, true); });
  }
  // Latest message from me, older than 3 days, within 60 days (the reply check is done per thread).
  GmailApp.search('in:sent older_than:' + OUR_HOME_QUIET_DAYS + 'd newer_than:' + OUR_HOME_WINDOW_DAYS + 'd', 0, OUR_HOME_MAX_THREADS)
    .forEach(function (t) {
      var msgs = t.getMessages();
      var lastAddr = (/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+/.exec(msgs[msgs.length - 1].getFrom() || '') || [''])[0].toLowerCase();
      var ageDays = (Date.now() - msgs[msgs.length - 1].getDate().getTime()) / 86400000;
      if (myEmails.indexOf(lastAddr) !== -1 && ageDays > OUR_HOME_QUIET_DAYS) add(t, false);
    });

  var body = JSON.stringify({ member: String(member).substring(0, 50), threads: Object.keys(records).map(function (k) { return records[k]; }) });
  var ts = Math.floor(Date.now() / 1000);
  var sig = ourHomeHex_(Utilities.computeHmacSha256Signature(ts + '.' + body, secret));
  var res = UrlFetchApp.fetch(OUR_HOME_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    payload: body,
    headers: { 'X-OurHome-Timestamp': String(ts), 'X-OurHome-Signature': sig },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 204) throw new Error('Our Home sync failed with status ' + res.getResponseCode());
}
