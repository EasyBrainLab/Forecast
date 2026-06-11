// Quell-Adapter für Ist-Umsätze. CSV-Upload heute, ERP-Abruf (OData) später — gleiche Engine (§6.4).
export interface RohIstZeile {
  zeilenNummer: number;
  dataareaid: string;
  kostenstelle: string;
  kostenstellenOwner: string;
  ktreb1: string;
  ktreb2: string;
  sachkonto: string;
  jahr: string;
  monat: string;
  tag: string;
  value: string;
  accountingAmount: string;
  recid: string;
  kostentraeger: string;
  postingtype: string;
  country: string;
}

export interface IstQuelleMeta {
  dateiname: string;
  hash: string;
}

export interface IstQuelleAdapter {
  lese(): Promise<RohIstZeile[]>;
  meta(): IstQuelleMeta;
}
