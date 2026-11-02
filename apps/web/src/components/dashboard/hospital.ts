// Placeholder hospital roster until the backend hospital endpoint is wired.
// Swap this list (and the shared logo) for the API response when it lands.
export interface Hospital {
  id: string;
  name: string;
  type: string;
  logo: string;
}

const PLACEHOLDER_LOGO = "/hospital/logo.svg";

export const HOSPITALS: Hospital[] = [
  {
    id: "riverside-general",
    name: "Riverside General Hospital",
    type: "General Acute Care Hospital",
    logo: PLACEHOLDER_LOGO,
  },
  {
    id: "st-mercy",
    name: "St. Mercy Medical Center",
    type: "General Acute Care Hospital",
    logo: PLACEHOLDER_LOGO,
  },
  {
    id: "lakeside-childrens",
    name: "Lakeside Children\u2019s Hospital",
    type: "Children\u2019s Hospital",
    logo: PLACEHOLDER_LOGO,
  },
];

export const DEFAULT_HOSPITAL_ID = HOSPITALS[0].id;
export const DEFAULT_HOSPITAL_LOGO = PLACEHOLDER_LOGO;
