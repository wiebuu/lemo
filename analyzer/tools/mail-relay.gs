/**
 * Lemody's mail relay: sends the emails the server asks for, from this Google account
 * (wiecodes@gmail.com). The VPS can't send mail itself — its host blocks the mail ports —
 * but it can call this over HTTPS.
 *
 * Set up (once, signed in as wiecodes@gmail.com):
 *   1. script.google.com → New project → paste this file.
 *   2. Project Settings → Script properties → add  SECRET = <the same value as
 *      MAIL_RELAY_SECRET in the server's analyzer/.env>.
 *   3. Deploy → New deployment → type "Web app" → Execute as: Me, Who has access: Anyone
 *      → Deploy → allow access → copy the web app URL into MAIL_RELAY_URL.
 *
 * Without the right secret it sends nothing.
 */
function doPost(e) {
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  var m;
  try {
    m = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput('bad request');
  }
  if (!secret || m.secret !== secret) return ContentService.createTextOutput('wrong secret');
  if (!m.to || !m.subject) return ContentService.createTextOutput('missing to / subject');
  GmailApp.sendEmail(m.to, m.subject, m.text || '', { htmlBody: m.html || undefined, name: 'Lemody' });
  return ContentService.createTextOutput('ok');
}
