import { E1Kategorie } from '@forecast/shared';

export interface E1Seed {
  kategorie: E1Kategorie;
  nameDe: string;
  nameEn: string;
  synonyme: string[];
  sortierung: number;
}

export const E1_SEED: readonly E1Seed[] = [
  {
    kategorie: E1Kategorie.IMPLANT,
    nameDe: 'Implantate',
    nameEn: 'Implants',
    synonyme: ['1_Implants', 'Implant', 'Revenue Implants'],
    sortierung: 1,
  },
  {
    kategorie: E1Kategorie.OPHTHALMO,
    nameDe: 'Ophthalmologie',
    nameEn: 'Ophthalmo',
    synonyme: ['2_Ophthalmo', 'Ophthalmo', 'Revenue Ophthalmo'],
    sortierung: 2,
  },
  {
    kategorie: E1Kategorie.AFTERLOADER,
    nameDe: 'Afterloader',
    nameEn: 'Afterloader',
    synonyme: ['3_Afterloader', 'Afterloader', 'Revenue Afterloader'],
    sortierung: 3,
  },
  {
    kategorie: E1Kategorie.OTHER,
    nameDe: 'Sonstige',
    nameEn: 'Other',
    synonyme: ['6_Other', 'Other', 'Revenue Other'],
    sortierung: 4,
  },
  {
    kategorie: E1Kategorie.ZENTRAL,
    nameDe: 'Zentral/Sonstige',
    nameEn: 'Central/Other',
    synonyme: [],
    sortierung: 5,
  },
];
