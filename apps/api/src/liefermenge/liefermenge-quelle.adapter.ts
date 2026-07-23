// Quell-Adapter für Liefermengen (SalesOrderLineitems). CSV-Upload heute, ERP-Abruf (OData) später — gleiche Engine.
export interface RohLiefermengeZeile {
  zeilenNummer: number;
  shippingDate: string; // Shipping_Date (ISO)
  auftragsnummer: string; // SOL_SALESORDERNUMBER
  kunde: string; // SO_DELIVERYADDRESSNAME
  itemNumber: string; // SOL_ITEMNUMBER
  cat00: string; // SO_Categorie_00
  cat01: string; // SO_Categorie_01
  stueckzahl: string; // Stueckzahl
  seedzahl: string; // Seedzahl
  orderedQty: string; // Summe von SOL_ORDEREDSALESQUANTITY
  lineAmount: string; // Summe von SOL_LINEAMOUNT
  kostenstelle: string; // Summe von SOL_Kostenstelle
  kostentraeger: string; // SOL_Kostenträger
  dataAreaId: string; // SOL_DATAAREAID
  countryCode: string; // SOL_DimensionValue_CountryCode (ISO2)
}

export interface LiefermengeQuelleMeta {
  dateiname: string;
  hash: string;
}

export interface LiefermengeQuelleAdapter {
  lese(): Promise<RohLiefermengeZeile[]>;
  meta(): LiefermengeQuelleMeta;
}
