# Löschkonzept

| Datenart | Frist / Auslöser | Vorgehen |
|---|---|---|
| Nutzerkonto (ausgeschiedene Beschäftigte) | bei Austritt | Status `DEAKTIVIERT`; Name pseudonymisieren; E-Mail entwerten |
| Einladungs-/Reset-Token | nach Ablauf (7 d / 2 h) bzw. Einlösung | Hash wird genullt |
| AuditTrail | gesetzliche Aufbewahrung (i. d. R. bis 10 Jahre) | append-only, **nicht** löschbar (DB-Trigger); E-Mail denormalisiert für Nachvollzug auch nach Konto-Pseudonymisierung |
| Geschäftsdaten (Ist/Budget/Forecast) | gemäß handels-/steuerrechtlicher Fristen | keine personenbezogene Löschpflicht (kein Personenbezug) |

**Soft-Delete:** Nutzer und RegionsVerantwortung werden nicht hart gelöscht (Historie/Audit bleibt konsistent).
Auskunfts-/Löschersuchen Betroffener werden manuell durch den Admin in Abstimmung mit dem DSB bearbeitet.
