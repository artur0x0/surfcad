/** Shared partner form options for /partners and POST /api/partners. */

export const PARTNER_TYPES = [
  { value: 'manufacturing', label: 'Manufacturing & fabrication' },
  { value: 'materials', label: 'Materials & supplies' },
  { value: 'software', label: 'Software & integrations' },
  { value: 'education', label: 'Education & training' },
  { value: 'reseller', label: 'Reseller / distribution' },
  { value: 'other', label: 'Other' },
];

export const PARTNER_TYPE_VALUES = new Set(PARTNER_TYPES.map((row) => row.value));
