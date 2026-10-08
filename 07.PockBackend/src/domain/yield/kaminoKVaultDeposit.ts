/**
 * KAMINO EARN: la instrucción de **depósito** en el vault, con su layout
 * verificado contra mainnet y contra el IDL oficial.
 *
 * ── Por qué este archivo existe al lado de `kaminoEarnVault.ts` ─────────────
 *
 * Aquel archivo sabe **leer** el vault. Este sabe **escribir** en él. Son dos
 * problemas distintos, con fuentes distintas y con riesgos distintos: leer mal
 * muestra un cero, escribir mal mueve plata.
 *
 * ── Lo que este archivo NO afirma ───────────────────────────────────────────
 *
 * Que un offset esté en una tabla aquí significa **exactamente** que se leyó de
 * una fuente nombrada, no que se haya deducido. La tabla de abajo dice cuál.
 *
 * ── El depósito NO es una instrucción: son cuatro ───────────────────────────
 *
 * Éste es el hallazgo que cambia el feature. La respuesta oficial de Kamino
 * (`POST api.kamino.finance/ktx/kvault/deposit-instructions`) para **este**
 * vault devuelve cuatro instrucciones, en este orden:
 *
 * | # | programa | qué hace |
 * |---|----------|----------|
 * | 0 | `ATokenGPvbd…` | crear la **ATA de las shares** de la persona |
 * | 1 | `KvauGMsp…` | **el depósito** en el vault (13 accounts + 8 restantes) |
 * | 2 | `FarmsPZpW…` | crear la cuenta de farm de la persona (rent) |
 * | 3 | `FarmsPZpW…` | **stakear las shares** en el farm del vault |
 *
 * Las 2 y 3 son las que hacen que las shares **no se vean en la billetera**:
 * el documento de Kamino lo dice ("shares are automatically staked in the farm
 * and are not visible in the user's wallet") y es cierto para este vault.
 *
 * > Nota: el ejemplo `libs/kvault-interface/examples/deposit.rs` del propio
 * > repositorio del programa afirma lo contrario ("the shares are not staked
 * > automatically… the user must **also** stake those shares"). Para este vault
 * > manda lo verificado: la respuesta de producción incluye las dos
 * > instrucciones de farm. Un doc del repo no le gana a una cadena.
 *
 * ── El discriminador, confirmado por partida triple ─────────────────────────
 *
 * | fuente | valor |
 * |---|---|
 * | `sha256("global:deposit")[0..8]`, calculado acá | `f2 23 c6 89 52 e1 f2 b6` |
 * | IDL autogenerado, `DEPOSIT_DISCRIMINATOR` | `[242, 35, 198, 137, 82, 225, 242, 182]` |
 * | respuesta de producción de Kamino, campo `data` | `8iPGiVLh8rY…` → empieza `f2 23 c6 89 52 e1 f2 b6` |
 *
 * Los tres coinciden byte a byte.
 */

/** El programa KVault. `getAccountInfo.owner` sobre el vault. */
export const KAMINO_KVAULT_PROGRAM_ID = 'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd';

/** El programa Farms, donde vive el stake de las shares. */
export const KAMINO_FARMS_PROGRAM_ID = 'FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr';

/** El programa KLend, dueño de cada reserve. */
export const KAMINO_KLEND_PROGRAM_ID = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';

/** SPL Token. Es el valor por omisión del account 9 de la instrucción. */
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/** Associated Token Account. La instrucción 0. */
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/**
 * `deposit`: los 8 primeros bytes de `sha256("global:deposit")`.
 *
 * El argumento se llama **`max_amount`**, no `amount`. El IDL autogenerado lo
 * llama así y la respuesta de producción manda un `u64` little-endian en la
 * misma posición. El nombre importa porque "max" es una promesa: si la persona
 * firmara con un importe mayor del que quiso, el programa no lo cobra.
 */
export const KVAULT_DEPOSIT_DISCRIMINATOR = Uint8Array.from([
  0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6,
]);

/**
 * Los 13 accounts, en el orden exacto, con sus permisos.
 *
 * Verificado de dos formas que coinciden: el IDL autogenerado de
 * `wp-solana-kamino-kvault-client` (`AccountMeta::new` = writable,
 * `new_readonly` = sólo lectura, y `is_signer` sólo en el 0) y los `role` de la
 * respuesta de producción para este vault.
 *
 * El 0 es el único `signer`: **la persona**. El 9 (`token_program`) es el único
 * account que el IDL marca `[optional]`, con `TokenkegQfe…` como valor por
 * omisión.
 */
export interface KvaultDepositAccount {
  readonly name: string;
  readonly writable: boolean;
  readonly signer: boolean;
  readonly optional: boolean;
}

export const KVAULT_DEPOSIT_ACCOUNTS: readonly KvaultDepositAccount[] = [
  { name: 'user', writable: true, signer: true, optional: false },
  { name: 'vault_state', writable: true, signer: false, optional: false },
  { name: 'token_vault', writable: true, signer: false, optional: false },
  { name: 'token_mint', writable: false, signer: false, optional: false },
  { name: 'base_vault_authority', writable: false, signer: false, optional: false },
  { name: 'shares_mint', writable: true, signer: false, optional: false },
  { name: 'user_token_ata', writable: true, signer: false, optional: false },
  { name: 'user_shares_ata', writable: true, signer: false, optional: false },
  { name: 'klend_program', writable: false, signer: false, optional: false },
  { name: 'token_program', writable: false, signer: false, optional: true },
  { name: 'shares_token_program', writable: false, signer: false, optional: false },
  { name: 'event_authority', writable: false, signer: false, optional: false },
  { name: 'program', writable: false, signer: false, optional: false },
];

/** Cuántos accounts nombrados tiene la instrucción, antes de los restantes. */
export const KVAULT_DEPOSIT_NAMED_ACCOUNTS = KVAULT_DEPOSIT_ACCOUNTS.length;

/* ── Los 8 accounts restantes: las reserves y sus lending markets ──────────── */

/**
 * El programa **exige** los `remaining_accounts`: los reserves donde el vault
 * despliega el depósito y el lending market de cada uno. Sin ellos la
 * instrucción no es válida.
 *
 * Y no es un detalle menor: son **los que hacen que la plata llegue a algún
 * lado**. Un depósito sin ellos no es un depósito parcial, es un depósito
 * inválido. Por eso no se construyen a mano: **se leen de la cadena**.
 *
 * | account | cantidad | writable | de dónde sale |
 * |---|---|---|---|
 * | reserve | 4 | sí | cuenta del vault, offset 312, stride 2160 |
 * | lending market | 4 | no | cuenta de la reserve, offset 32 |
 *
 * Los cuatro reserves existen y son del programa KLend. El cuarto lending market
 * (`6WEGfej9…`) tiene 33 352 320 lamports contra los 60–70 M de los reserves:
 * no es un dato raro, es que un mercado con un solo reserve es chico. Los cuatro
 * mercados se leyeron, uno por uno, del offset 32 de su reserve.
 */
export const KVAULT_REMAINING_ACCOUNTS = {
  reserveCount: 4,
  lendingMarketCount: 4,
} as const;

/** El primer investment target vive en este offset de la cuenta del vault. */
export const KVAULT_INVESTMENT_TARGETS_OFFSET = 312;

/**
 * Cada target ocupa 2160 bytes y **arranca** con la pubkey de la reserve.
 *
 * El tamaño del struct no importa acá: lo que se usa es el primer field, y el
 * paso se aplica para el siguiente. Verificado byte a byte: el slice
 * `[312 + i·2160, +32)` es idéntico a la pubkey de la reserve para los cuatro,
 * y `[8952, 8984)` —el quinto— es todo cero.
 */
export const KVAULT_INVESTMENT_TARGET_STRIDE = 2160;

/** Los 32 bytes de la pubkey, que es el primer campo del target. */
export const KVAULT_INVESTMENT_TARGET_RESERVE_BYTES = 32;

/**
 * La lending market vive en el offset **32** de la cuenta de la reserve.
 *
 * Las cuatro reserves del vault miden 8 624 bytes y son del programa KLend. En
 * las cuatro, el slice `[32, 64)` decodifica exactamente a la lending market que
 * Kamino manda como account restante. Sin ese campo, el depósito no puede
 * armarse: son 8 de los 21 accounts de la instrucción.
 */
export const KLEND_RESERVE_LENDING_MARKET_OFFSET = 32;

/** La lending market es una pubkey: 32 bytes. */
export const KLEND_RESERVE_LENDING_MARKET_BYTES = 32;

/**
 * **`lending_market` NO se deriva por PDA.** Se comprobó contra las cuatro
 * reserves con `findProgramAddress` y cuatro juegos de seeds
 * (`lending_market`, `market`, `klend_market`, `lendingMarket`, cada uno con y
 * sin la pubkey de la reserve): ninguna combinación reproduce los mercados que
 * Kamino manda. Se **lee**.
 */

/**
 * El `discriminator` del vault y el tamaño de su cuenta, repetidos acá para que
 * quien lea este archivo no tenga que abrir el otro.
 */
export const KVAULT_ACCOUNT_BYTES = 62552;

/**
 * Lo que **no** se verificó, y por eso la instrucción todavía no está armada.
 *
 * 1. **`simulateTransaction` contra mainnet.** Falta la simulación con una
 *    cuenta que tenga USDC de Solana y SOL. Con una cuenta sin fondos se
 *    descarta la firma pero no se prueba el resto del camino.
 * 2. **El ATA de USDC de la persona.** La instrucción 0 crea la ATA de las
 *    *shares*. La ATA de **USDC** (`user_token_ata`, account 6) **no** la crea
 *    Kamino en su respuesta: hay que derivarla y crearla aparte si no existe. Sin
 *    SOL para la renta, el primer depósito falla.
 * 3. **La cuenta de farm.** La instrucción 2 la crea y la instrucción 3 la
 *    usa. Para este vault, `9FVjHqduhDPMVqvu3cXiEBjU6nvxvGdCCLRwd9WpVRzj`
 *    **no es una cuenta**: `getMultipleAccounts` devuelve `null`, y
 *    `3bMUivmhqJkFUkSdYv976tvdbuGFza74RJgg4Mh1t8cW` tampoco. La 2 la crea con
 *    la 3. Es lo que hace que el **primer** depósito de una persona sea más caro
 *    que el segundo, y la UI tendría que poder decirlo.
 */