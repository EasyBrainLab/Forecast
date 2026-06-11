// E&Z-CI: Primärblau #0F516A, Akzentrot #AA003C, Arial.
const PRIMARY = '#0F516A';
const ACCENT = '#AA003C';

function layout(titel: string, inhaltHtml: string): string {
  return `<!doctype html><html lang="de"><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
  <div style="max-width:600px;margin:0 auto;background:#ffffff">
    <div style="background:${PRIMARY};color:#fff;padding:20px 24px;font-size:18px;font-weight:bold">Forecast-Portal BU Brachytherapie</div>
    <div style="padding:24px">
      <h2 style="color:${PRIMARY};margin-top:0">${titel}</h2>
      ${inhaltHtml}
    </div>
    <div style="padding:16px 24px;border-top:1px solid #e5e5e5;font-size:12px;color:#777">
      Eckert &amp; Ziegler — automatische Nachricht, bitte nicht antworten.
    </div>
  </div></body></html>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${url}" style="background:${PRIMARY};color:#fff;text-decoration:none;padding:12px 20px;border-radius:4px;display:inline-block">${label}</a></p>
  <p style="font-size:12px;color:#777">Falls der Button nicht funktioniert: ${url}</p>`;
}

export interface MailInhalt {
  subject: string;
  html: string;
  text: string;
}

export function einladungMail(name: string, url: string, tageGueltig: number): MailInhalt {
  return {
    subject: 'Einladung zum Forecast-Portal',
    html: layout(
      `Willkommen, ${name}`,
      `<p>Sie wurden zum Forecast-Portal eingeladen. Bitte setzen Sie Ihr Passwort innerhalb von ${tageGueltig} Tagen.</p>${button(url, 'Konto aktivieren')}`,
    ),
    text: `Willkommen, ${name}. Konto aktivieren (gültig ${tageGueltig} Tage): ${url}`,
  };
}

export function passwortResetMail(url: string, stundenGueltig: number): MailInhalt {
  return {
    subject: 'Passwort zurücksetzen',
    html: layout(
      'Passwort zurücksetzen',
      `<p>Setzen Sie Ihr Passwort innerhalb von ${stundenGueltig} Stunden zurück. Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail.</p>${button(url, 'Passwort zurücksetzen')}`,
    ),
    text: `Passwort zurücksetzen (gültig ${stundenGueltig}h): ${url}`,
  };
}

export function infoMail(subject: string, titel: string, text: string): MailInhalt {
  return { subject, html: layout(titel, `<p>${text}</p>`), text };
}

export function kontoGesperrtMail(minuten: number): MailInhalt {
  return {
    subject: 'Konto vorübergehend gesperrt',
    html: layout(
      'Konto gesperrt',
      `<p style="color:${ACCENT}">Ihr Konto wurde nach zu vielen Fehlversuchen für ${minuten} Minuten gesperrt.</p>`,
    ),
    text: `Konto nach Fehlversuchen für ${minuten} Minuten gesperrt.`,
  };
}
