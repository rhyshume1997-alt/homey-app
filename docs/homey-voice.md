# Homey's voice

Homey is the house assistant in Our Home: a small, friendly character who helps Alex and Sam keep track of the house. The words live in `src/components/homey/copy.ts`. Change them there, and keep the tests in `tests/components/homey-copy.test.ts` passing.

## Who Homey sounds like

- A helpful housemate, not a butler or a salesperson.
- Warm and plain. Says what needs doing, then stops.
- Calm about problems. Overdue means "want to tackle it?", not an alarm.
- Never pushy. Homey suggests; the person decides.

## Rules

1. **Short.** Each line is 90 characters or fewer, after placeholders are filled. Two sentences at most.
2. **UK English.** Use "colour", "organise", "recognise", "centre", "favourite". Dates read "1 Nov", not "Nov 1".
3. **No money.** Never a number with a currency, never "£", "$" or "€", and no words such as "pounds" or "paid". Homey does not talk about budgets, amounts or balances. Bills appear by name and date only.
4. **Never claim an action that has not happened.** Say "Want to add a reminder?", not "I've added a reminder." Drafted thank-yous are a draft until the person taps Send.
5. **Never act alone.** Homey proposes; the person confirms. Copy must not imply a change has been saved, sent or booked unless the person just confirmed it.
6. **No email talk.** Thank-yous are in-app only. Homey never mentions sending an email.
7. **Names, not details.** Use first names and item titles. No references, email addresses, notes or document contents.
8. **The heart is for thanks.** The purple heart (💜) closes thank-you drafts and nothing else.
9. **Plain punctuation.** Full stops and question marks. No exclamation marks in alerts.

## Examples

| Situation | Say | Avoid |
| --- | --- | --- |
| Morning greeting | "Morning, Sam. Here's what needs doing today." | "Good morning, Sam! You have 5 tasks!!" |
| Overdue task | "Boiler service is overdue. Want to tackle it?" | "URGENT: Boiler service is 3 days late!" |
| Renewal | "Car insurance renews on 1 Nov. Add a reminder?" | "Car insurance renews for a set amount on 1 Nov." |
| Activity | "Sam added a task. Say thanks?" | "Sam has sent you a thank-you." |
| Nothing to do | "All clear today. Nicely done." | "You have completed everything!" |
| Hidden | "Homey's hidden. Bring him back in More > Homey" | "I'm gone forever." |

## Faces

Homey's expression follows the moment, through `EXPRESSION_FOR_EVENT`. Red overdue is `shocked`, amber is `concerned`, all green is `happy`, and hidden or idle is `sleepy`. The face is never the only signal; the words say the same thing.

## Before you ship a line

- Is it under 90 characters with placeholders filled?
- Is it at most two sentences?
- Does it say what is true, and nothing the person has not confirmed?
- Is there any money, currency or email wording? Remove it.
- Does it read well in UK English?
