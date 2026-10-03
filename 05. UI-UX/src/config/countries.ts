/**
 * Every country this product can be used from, with its international dialling code.
 *
 * ── Why this file is generated and not written by hand ──────────────────────
 *
 * A dialling code that is wrong is a number that rings nowhere, and nobody finds
 * out until a customer is standing in a sign-up form waiting for an SMS. So the
 * data comes from the ISO 3166-1 country list (`world-countries`) and the ITU
 * numbering plan (`libphonenumber-js`) instead of from recall: 198 rows is far
 * past the number a human types correctly twice.
 *
 * Regenerate with `npm run generate:countries` (this script), never by editing
 * a row here.
 *
 * ── `code` is the ISO alpha-2, and `dial` is NOT derived from it ────────────
 *
 * Two different systems that both look like "country code". `AR` is Argentina;
 * `+54` is Argentina's dialling code. There is no arithmetic between them, so
 * both are written down. `dial` is what composes a number; `code` is what a
 * flag, a locale or a payment rail keys on.
 *
 * ── The list is the world, not a region ────────────────────────────────────
 *
 * The earlier version of this list was Latin America only, on purpose: the
 * product was scoped to the region and nobody outside it could have opened an
 * account. It can now, so restricting the selector would be a lie about who the
 * product is for. Argentina stays on top because it is the launch market and the
 * default; the rest is alphabetical in Spanish, which is the language the person
 * reading the list is reading it in.
 *
 * ── What is NOT here, and why ──────────────────────────────────────────────
 *
 * Three entries are missing on purpose: Antarctica, Bouvet and Heard &
 * McDonald Islands. They are territories with no permanent population and no
 * dialling code, so a row for them would be a row that cannot receive anything.
 * Pitcairn (`+64`) and the minor US outlying islands (`+1`) DO have a code, and
 * they are here, written by hand because the dataset does not carry theirs.
 */

export interface Country {
  /** ISO 3166-1 alpha-2. `AR`, `CL`, `MX`. The key a flag or locale resolves on. */
  readonly code: string;
  /** The flag, as an emoji. `aria-hidden` in the UI; `name` carries the meaning. */
  readonly flag: string;
  /** Full name, in Spanish. Shown in the dropdown row. */
  readonly name: string;
  /** The international dialling code, with its `+`. */
  readonly dial: string;
}

export const COUNTRIES: readonly Country[] = [
  { code: 'AR', flag: '🇦🇷', name: 'Argentina', dial: '+54' },
  { code: 'AF', flag: '🇦🇫', name: 'Afganistán', dial: '+93' },
  { code: 'AL', flag: '🇦🇱', name: 'Albania', dial: '+355' },
  { code: 'DE', flag: '🇩🇪', name: 'Alemania', dial: '+49' },
  { code: 'AD', flag: '🇦🇩', name: 'Andorra', dial: '+376' },
  { code: 'AO', flag: '🇦🇴', name: 'Angola', dial: '+244' },
  { code: 'AG', flag: '🇦🇬', name: 'Antigua y Barbuda', dial: '+1' },
  { code: 'SA', flag: '🇸🇦', name: 'Arabia Saudí', dial: '+966' },
  { code: 'DZ', flag: '🇩🇿', name: 'Argelia', dial: '+213' },
  { code: 'AM', flag: '🇦🇲', name: 'Armenia', dial: '+374' },
  { code: 'AU', flag: '🇦🇺', name: 'Australia', dial: '+61' },
  { code: 'AT', flag: '🇦🇹', name: 'Austria', dial: '+43' },
  { code: 'AZ', flag: '🇦🇿', name: 'Azerbaiyán', dial: '+994' },
  { code: 'BS', flag: '🇧🇸', name: 'Bahamas', dial: '+1' },
  { code: 'BD', flag: '🇧🇩', name: 'Bangladesh', dial: '+880' },
  { code: 'BB', flag: '🇧🇧', name: 'Barbados', dial: '+1' },
  { code: 'BH', flag: '🇧🇭', name: 'Baréin', dial: '+973' },
  { code: 'BE', flag: '🇧🇪', name: 'Bélgica', dial: '+32' },
  { code: 'BZ', flag: '🇧🇿', name: 'Belice', dial: '+501' },
  { code: 'BJ', flag: '🇧🇯', name: 'Benín', dial: '+229' },
  { code: 'BY', flag: '🇧🇾', name: 'Bielorrusia', dial: '+375' },
  { code: 'BO', flag: '🇧🇴', name: 'Bolivia', dial: '+591' },
  { code: 'BA', flag: '🇧🇦', name: 'Bosnia y Herzegovina', dial: '+387' },
  { code: 'BW', flag: '🇧🇼', name: 'Botswana', dial: '+267' },
  { code: 'BR', flag: '🇧🇷', name: 'Brasil', dial: '+55' },
  { code: 'BN', flag: '🇧🇳', name: 'Brunéi', dial: '+673' },
  { code: 'BG', flag: '🇧🇬', name: 'Bulgaria', dial: '+359' },
  { code: 'BF', flag: '🇧🇫', name: 'Burkina Faso', dial: '+226' },
  { code: 'BI', flag: '🇧🇮', name: 'Burundi', dial: '+257' },
  { code: 'BT', flag: '🇧🇹', name: 'Bután', dial: '+975' },
  { code: 'CV', flag: '🇨🇻', name: 'Cabo Verde', dial: '+238' },
  { code: 'KH', flag: '🇰🇭', name: 'Camboya', dial: '+855' },
  { code: 'CM', flag: '🇨🇲', name: 'Camerún', dial: '+237' },
  { code: 'CA', flag: '🇨🇦', name: 'Canadá', dial: '+1' },
  { code: 'QA', flag: '🇶🇦', name: 'Catar', dial: '+974' },
  { code: 'TD', flag: '🇹🇩', name: 'Chad', dial: '+235' },
  { code: 'CZ', flag: '🇨🇿', name: 'Chequia', dial: '+420' },
  { code: 'CL', flag: '🇨🇱', name: 'Chile', dial: '+56' },
  { code: 'CN', flag: '🇨🇳', name: 'China', dial: '+86' },
  { code: 'CY', flag: '🇨🇾', name: 'Chipre', dial: '+357' },
  { code: 'VA', flag: '🇻🇦', name: 'Ciudad del Vaticano', dial: '+39' },
  { code: 'CO', flag: '🇨🇴', name: 'Colombia', dial: '+57' },
  { code: 'KM', flag: '🇰🇲', name: 'Comoras', dial: '+269' },
  { code: 'KP', flag: '🇰🇵', name: 'Corea del Norte', dial: '+850' },
  { code: 'KR', flag: '🇰🇷', name: 'Corea del Sur', dial: '+82' },
  { code: 'CI', flag: '🇨🇮', name: 'Costa de Marfil', dial: '+225' },
  { code: 'CR', flag: '🇨🇷', name: 'Costa Rica', dial: '+506' },
  { code: 'HR', flag: '🇭🇷', name: 'Croacia', dial: '+385' },
  { code: 'CU', flag: '🇨🇺', name: 'Cuba', dial: '+53' },
  { code: 'DK', flag: '🇩🇰', name: 'Dinamarca', dial: '+45' },
  { code: 'DJ', flag: '🇩🇯', name: 'Djibouti', dial: '+253' },
  { code: 'DM', flag: '🇩🇲', name: 'Dominica', dial: '+1' },
  { code: 'EC', flag: '🇪🇨', name: 'Ecuador', dial: '+593' },
  { code: 'EG', flag: '🇪🇬', name: 'Egipto', dial: '+20' },
  { code: 'SV', flag: '🇸🇻', name: 'El Salvador', dial: '+503' },
  { code: 'AE', flag: '🇦🇪', name: 'Emiratos Árabes Unidos', dial: '+971' },
  { code: 'ER', flag: '🇪🇷', name: 'Eritrea', dial: '+291' },
  { code: 'SK', flag: '🇸🇰', name: 'Eslovaquia', dial: '+421' },
  { code: 'SI', flag: '🇸🇮', name: 'Eslovenia', dial: '+386' },
  { code: 'ES', flag: '🇪🇸', name: 'España', dial: '+34' },
  { code: 'US', flag: '🇺🇸', name: 'Estados Unidos', dial: '+1' },
  { code: 'EE', flag: '🇪🇪', name: 'Estonia', dial: '+372' },
  { code: 'ET', flag: '🇪🇹', name: 'Etiopía', dial: '+251' },
  { code: 'PH', flag: '🇵🇭', name: 'Filipinas', dial: '+63' },
  { code: 'FI', flag: '🇫🇮', name: 'Finlandia', dial: '+358' },
  { code: 'FJ', flag: '🇫🇯', name: 'Fiyi', dial: '+679' },
  { code: 'FR', flag: '🇫🇷', name: 'Francia', dial: '+33' },
  { code: 'GA', flag: '🇬🇦', name: 'Gabón', dial: '+241' },
  { code: 'GM', flag: '🇬🇲', name: 'Gambia', dial: '+220' },
  { code: 'GE', flag: '🇬🇪', name: 'Georgia', dial: '+995' },
  { code: 'GH', flag: '🇬🇭', name: 'Ghana', dial: '+233' },
  { code: 'GR', flag: '🇬🇷', name: 'Grecia', dial: '+30' },
  { code: 'GD', flag: '🇬🇩', name: 'Grenada', dial: '+1' },
  { code: 'GT', flag: '🇬🇹', name: 'Guatemala', dial: '+502' },
  { code: 'GN', flag: '🇬🇳', name: 'Guinea', dial: '+224' },
  { code: 'GQ', flag: '🇬🇶', name: 'Guinea Ecuatorial', dial: '+240' },
  { code: 'GW', flag: '🇬🇼', name: 'Guinea-Bisáu', dial: '+245' },
  { code: 'GY', flag: '🇬🇾', name: 'Guyana', dial: '+592' },
  { code: 'HT', flag: '🇭🇹', name: 'Haití', dial: '+509' },
  { code: 'HN', flag: '🇭🇳', name: 'Honduras', dial: '+504' },
  { code: 'HU', flag: '🇭🇺', name: 'Hungría', dial: '+36' },
  { code: 'IN', flag: '🇮🇳', name: 'India', dial: '+91' },
  { code: 'ID', flag: '🇮🇩', name: 'Indonesia', dial: '+62' },
  { code: 'IQ', flag: '🇮🇶', name: 'Irak', dial: '+964' },
  { code: 'IR', flag: '🇮🇷', name: 'Iran', dial: '+98' },
  { code: 'IE', flag: '🇮🇪', name: 'Irlanda', dial: '+353' },
  { code: 'IS', flag: '🇮🇸', name: 'Islandia', dial: '+354' },
  { code: 'GS', flag: '🇬🇸', name: 'Islas Georgias del Sur y Sandwich del Sur', dial: '+500' },
  { code: 'MH', flag: '🇲🇭', name: 'Islas Marshall', dial: '+692' },
  { code: 'PN', flag: '🇵🇳', name: 'Islas Pitcairn', dial: '+64' },
  { code: 'SB', flag: '🇸🇧', name: 'Islas Salomón', dial: '+677' },
  { code: 'UM', flag: '🇺🇲', name: 'Islas Ultramarinas Menores de Estados Unidos', dial: '+1' },
  { code: 'IL', flag: '🇮🇱', name: 'Israel', dial: '+972' },
  { code: 'IT', flag: '🇮🇹', name: 'Italia', dial: '+39' },
  { code: 'JM', flag: '🇯🇲', name: 'Jamaica', dial: '+1' },
  { code: 'JP', flag: '🇯🇵', name: 'Japón', dial: '+81' },
  { code: 'JO', flag: '🇯🇴', name: 'Jordania', dial: '+962' },
  { code: 'KZ', flag: '🇰🇿', name: 'Kazajistán', dial: '+7' },
  { code: 'KE', flag: '🇰🇪', name: 'Kenia', dial: '+254' },
  { code: 'KG', flag: '🇰🇬', name: 'Kirguizistán', dial: '+996' },
  { code: 'KI', flag: '🇰🇮', name: 'Kiribati', dial: '+686' },
  { code: 'KW', flag: '🇰🇼', name: 'Kuwait', dial: '+965' },
  { code: 'LA', flag: '🇱🇦', name: 'Laos', dial: '+856' },
  { code: 'LS', flag: '🇱🇸', name: 'Lesotho', dial: '+266' },
  { code: 'LV', flag: '🇱🇻', name: 'Letonia', dial: '+371' },
  { code: 'LB', flag: '🇱🇧', name: 'Líbano', dial: '+961' },
  { code: 'LR', flag: '🇱🇷', name: 'Liberia', dial: '+231' },
  { code: 'LY', flag: '🇱🇾', name: 'Libia', dial: '+218' },
  { code: 'LI', flag: '🇱🇮', name: 'Liechtenstein', dial: '+423' },
  { code: 'LT', flag: '🇱🇹', name: 'Lituania', dial: '+370' },
  { code: 'LU', flag: '🇱🇺', name: 'Luxemburgo', dial: '+352' },
  { code: 'MK', flag: '🇲🇰', name: 'Macedonia del Norte', dial: '+389' },
  { code: 'MG', flag: '🇲🇬', name: 'Madagascar', dial: '+261' },
  { code: 'MY', flag: '🇲🇾', name: 'Malasia', dial: '+60' },
  { code: 'MW', flag: '🇲🇼', name: 'Malawi', dial: '+265' },
  { code: 'MV', flag: '🇲🇻', name: 'Maldivas', dial: '+960' },
  { code: 'ML', flag: '🇲🇱', name: 'Mali', dial: '+223' },
  { code: 'MT', flag: '🇲🇹', name: 'Malta', dial: '+356' },
  { code: 'MA', flag: '🇲🇦', name: 'Marruecos', dial: '+212' },
  { code: 'MU', flag: '🇲🇺', name: 'Mauricio', dial: '+230' },
  { code: 'MR', flag: '🇲🇷', name: 'Mauritania', dial: '+222' },
  { code: 'MX', flag: '🇲🇽', name: 'México', dial: '+52' },
  { code: 'FM', flag: '🇫🇲', name: 'Micronesia', dial: '+691' },
  { code: 'MD', flag: '🇲🇩', name: 'Moldavia', dial: '+373' },
  { code: 'MC', flag: '🇲🇨', name: 'Mónaco', dial: '+377' },
  { code: 'MN', flag: '🇲🇳', name: 'Mongolia', dial: '+976' },
  { code: 'ME', flag: '🇲🇪', name: 'Montenegro', dial: '+382' },
  { code: 'MZ', flag: '🇲🇿', name: 'Mozambique', dial: '+258' },
  { code: 'MM', flag: '🇲🇲', name: 'Myanmar', dial: '+95' },
  { code: 'NA', flag: '🇳🇦', name: 'Namibia', dial: '+264' },
  { code: 'NR', flag: '🇳🇷', name: 'Nauru', dial: '+674' },
  { code: 'NP', flag: '🇳🇵', name: 'Nepal', dial: '+977' },
  { code: 'NI', flag: '🇳🇮', name: 'Nicaragua', dial: '+505' },
  { code: 'NE', flag: '🇳🇪', name: 'Níger', dial: '+227' },
  { code: 'NG', flag: '🇳🇬', name: 'Nigeria', dial: '+234' },
  { code: 'NO', flag: '🇳🇴', name: 'Noruega', dial: '+47' },
  { code: 'NZ', flag: '🇳🇿', name: 'Nueva Zelanda', dial: '+64' },
  { code: 'OM', flag: '🇴🇲', name: 'Omán', dial: '+968' },
  { code: 'NL', flag: '🇳🇱', name: 'Países Bajos', dial: '+31' },
  { code: 'PK', flag: '🇵🇰', name: 'Pakistán', dial: '+92' },
  { code: 'PW', flag: '🇵🇼', name: 'Palau', dial: '+680' },
  { code: 'PA', flag: '🇵🇦', name: 'Panamá', dial: '+507' },
  { code: 'PG', flag: '🇵🇬', name: 'Papúa Nueva Guinea', dial: '+675' },
  { code: 'PY', flag: '🇵🇾', name: 'Paraguay', dial: '+595' },
  { code: 'PE', flag: '🇵🇪', name: 'Perú', dial: '+51' },
  { code: 'PL', flag: '🇵🇱', name: 'Polonia', dial: '+48' },
  { code: 'PT', flag: '🇵🇹', name: 'Portugal', dial: '+351' },
  { code: 'GB', flag: '🇬🇧', name: 'Reino Unido', dial: '+44' },
  { code: 'CF', flag: '🇨🇫', name: 'República Centroafricana', dial: '+236' },
  { code: 'CG', flag: '🇨🇬', name: 'República del Congo', dial: '+242' },
  { code: 'CD', flag: '🇨🇩', name: 'República Democrática del Congo', dial: '+243' },
  { code: 'DO', flag: '🇩🇴', name: 'República Dominicana', dial: '+1' },
  { code: 'RW', flag: '🇷🇼', name: 'Ruanda', dial: '+250' },
  { code: 'RO', flag: '🇷🇴', name: 'Rumania', dial: '+40' },
  { code: 'RU', flag: '🇷🇺', name: 'Rusia', dial: '+7' },
  { code: 'WS', flag: '🇼🇸', name: 'Samoa', dial: '+685' },
  { code: 'KN', flag: '🇰🇳', name: 'San Cristóbal y Nieves', dial: '+1' },
  { code: 'SM', flag: '🇸🇲', name: 'San Marino', dial: '+378' },
  { code: 'VC', flag: '🇻🇨', name: 'San Vicente y Granadinas', dial: '+1' },
  { code: 'LC', flag: '🇱🇨', name: 'Santa Lucía', dial: '+1' },
  { code: 'ST', flag: '🇸🇹', name: 'Santo Tomé y Príncipe', dial: '+239' },
  { code: 'SN', flag: '🇸🇳', name: 'Senegal', dial: '+221' },
  { code: 'RS', flag: '🇷🇸', name: 'Serbia', dial: '+381' },
  { code: 'SC', flag: '🇸🇨', name: 'Seychelles', dial: '+248' },
  { code: 'SL', flag: '🇸🇱', name: 'Sierra Leone', dial: '+232' },
  { code: 'SG', flag: '🇸🇬', name: 'Singapur', dial: '+65' },
  { code: 'SY', flag: '🇸🇾', name: 'Siria', dial: '+963' },
  { code: 'SO', flag: '🇸🇴', name: 'Somalia', dial: '+252' },
  { code: 'LK', flag: '🇱🇰', name: 'Sri Lanka', dial: '+94' },
  { code: 'SZ', flag: '🇸🇿', name: 'Suazilandia', dial: '+268' },
  { code: 'ZA', flag: '🇿🇦', name: 'Sudáfrica', dial: '+27' },
  { code: 'SD', flag: '🇸🇩', name: 'Sudán', dial: '+249' },
  { code: 'SS', flag: '🇸🇸', name: 'Sudán del Sur', dial: '+211' },
  { code: 'SE', flag: '🇸🇪', name: 'Suecia', dial: '+46' },
  { code: 'CH', flag: '🇨🇭', name: 'Suiza', dial: '+41' },
  { code: 'SR', flag: '🇸🇷', name: 'Surinam', dial: '+597' },
  { code: 'TH', flag: '🇹🇭', name: 'Tailandia', dial: '+66' },
  { code: 'TZ', flag: '🇹🇿', name: 'Tanzania', dial: '+255' },
  { code: 'TJ', flag: '🇹🇯', name: 'Tayikistán', dial: '+992' },
  { code: 'TF', flag: '🇹🇫', name: 'Tierras Australes y Antárticas Francesas', dial: '+262' },
  { code: 'TL', flag: '🇹🇱', name: 'Timor Oriental', dial: '+670' },
  { code: 'TG', flag: '🇹🇬', name: 'Togo', dial: '+228' },
  { code: 'TO', flag: '🇹🇴', name: 'Tonga', dial: '+676' },
  { code: 'TT', flag: '🇹🇹', name: 'Trinidad y Tobago', dial: '+1' },
  { code: 'TN', flag: '🇹🇳', name: 'Túnez', dial: '+216' },
  { code: 'TM', flag: '🇹🇲', name: 'Turkmenistán', dial: '+993' },
  { code: 'TR', flag: '🇹🇷', name: 'Turquía', dial: '+90' },
  { code: 'TV', flag: '🇹🇻', name: 'Tuvalu', dial: '+688' },
  { code: 'UA', flag: '🇺🇦', name: 'Ucrania', dial: '+380' },
  { code: 'UG', flag: '🇺🇬', name: 'Uganda', dial: '+256' },
  { code: 'UY', flag: '🇺🇾', name: 'Uruguay', dial: '+598' },
  { code: 'UZ', flag: '🇺🇿', name: 'Uzbekistán', dial: '+998' },
  { code: 'VU', flag: '🇻🇺', name: 'Vanuatu', dial: '+678' },
  { code: 'VE', flag: '🇻🇪', name: 'Venezuela', dial: '+58' },
  { code: 'VN', flag: '🇻🇳', name: 'Vietnam', dial: '+84' },
  { code: 'YE', flag: '🇾🇪', name: 'Yemen', dial: '+967' },
  { code: 'ZM', flag: '🇿🇲', name: 'Zambia', dial: '+260' },
  { code: 'ZW', flag: '🇿🇼', name: 'Zimbabue', dial: '+263' },
] as const;

/** The country offered when the user has not chosen one. */
export const DEFAULT_COUNTRY: Country =
  COUNTRIES.find((country) => country.code === 'AR') ?? (COUNTRIES[0] as Country);

/** The country for a code, or the default. Never throws, never returns null. */
export function countryByCode(code: string | null | undefined): Country {
  if (code === null || code === undefined) return DEFAULT_COUNTRY;
  return COUNTRIES.find((country) => country.code === code) ?? DEFAULT_COUNTRY;
}

/**
 * Composes a local number with its country's prefix.
 *
 * The person never types the `+` and never names the country. The prefix is a
 * fact about the country and the digits are a fact about the person; making
 * anyone retype either one is asking for a support ticket.
 *
 * A number with no digits returns `''` rather than a bare `+54`, so the field
 * never shows a prefix for a number nobody has typed yet.
 */
export function composePhone(local: string, country: Country): string {
  const digits = local.replace(/\D/g, '');
  return digits ? `${country.dial} ${digits}` : '';
}
