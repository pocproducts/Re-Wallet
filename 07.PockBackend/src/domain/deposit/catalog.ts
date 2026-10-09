/**
 * EL CATÁLOGO DE DEPÓSITO: qué se puede recibir, en qué red, y con qué dirección.
 *
 * ── Por qué vive acá, en el servidor ───────────────────────────────────────────
 *
 * El front **no** puede tener su propia lista de redes ni de activos para
 * depositar. Antes la tenía —`Bnb Chain (BEP20)` escrita a mano como red por
 * defecto, una lista de redes y un catálogo mock de BTC/DOGE/USDT— y el
 * resultado era una pantalla que pedalía redes que la billetera no tiene y
 * jamming **ninguna** dirección real de la persona.
 *
 * La razón no es puramente de arquitectura: es que la lista de lo que se puede
 * recibir es una verdad del **lado que custodia**. "Se puede depositar USDC en
 * Monad" sólo es cierto si hay un contrato USDC en Monad que la app puede leer,
 * y eso lo sabe el servidor, que lo verifica contra la cadena. Si el front
 * listara redes, tendría la lista completa —incluidas las que no existen para
 * esta billetera— y filtraría, o sea que sabría de destinos que el producto no
 * ofrece.
 *
 * ── Por qué `balanceReadable` viaja POR ACTIVO y no por red ────────────────────
 *
 * Porque depende del **token**, no de la cadena: el MON nativo de Monad y un
 * ERC-20 de Monad usan la misma dirección y la misma red, y uno puede tener un
 * lector verificado mientras el otro todavía no. Un flag por red obligaría a
 * elegir entre mentir sobre el que sí se lee o mentir sobre el que no.
 *
 * Y qué significa `false`: **el activo se puede recibir igual.** No es "no
 * soportado": es "no sabemos cuánto tenés". Por eso un activo con
 * `balanceReadable: false` aparece con su red y su dirección, y lo que la
 * pantalla no muestra es la cifra. Un `0` en su lugar afirmaría algo que nadie
 * sabe —y en un producto de pagos, un cero inventado no es un detalle.
 *
 * ── Por qué el orden de los activos es fijo ───────────────────────────────────
 *
 * Es el orden en que la persona los ve. Una lista que se reordena entre lecturas
 * convierte "el que estaba segundo" en "el que elegís después", y en una pantalla
 * donde elegir mal se paga, eso no es cosmético. Por eso el orden vive en este
 * array y hay un test que lo afirma por red.
 *
 * ── Por qué cada activo declara `kind` y no un `isDollar` ────────────────────
 *
 * Porque la pantalla de depósito tiene **dos caminos**: "Cripto" y "Dólares
 * digitales", y la pregunta "¿qué activo pertenece a cuál?" tiene que tener una
 * sola respuesta. Si esa respuesta viviera en las pantallas, cada una tendría su
 * lista y agregar un dólar sería editar dos pantallas —que es exactamente el
 * trabajo que esta clasificación viene a eliminar—. Con `kind` en la fila, las
 * dos pantallas **filtran** la misma respuesta y un USDT verifiable entra solo.
 *
 * Y el nombre es `kind` con dos valores, y no `isDollar`, porque `isDollar:
 * false` se lee como "todo lo demás", y acá "todo lo demás" no es una categoría
 * honesta: es lo que todavía nadie clasificó. Un `kind` obliga a clasificar cada
 * fila, y una fila sin clasificar es un error de compilación.
 *
 * ── Por qué cada token futuro entra con su contrato verificado ────────────────
 *
 * El campo `token` es el contrato **de esa red**, no el de otra: el USDC de
 * Monad y el de Ethereum son direcciones distintas y cada una responde con su
 * propio contrato. Copiar la dirección de una red a otra es exactamente el bug
 * que este repositorio ya pagó una vez (ver `../portfolio/assets.ts`). Por eso
 * la regla es una sola: un token entra acá **después** de verificar en cadena
 * que existe, que tiene bytecode y que `symbol()`/`decimals()` dicen lo que
 * dice esta fila.
 */
import type { EvmNetworkId } from '../wallet/evmNetwork';
import type { PortfolioChain } from '../portfolio/networks';

/**
 * Las redes en las que se puede recibir. Es el mismo conjunto de cadenas que el
 * portfolio lee: una red en la que no hay lector tampoco puede ser una red de
 * depósito honesta.
 */
export type DepositChain = PortfolioChain;

/**
 * Cómo se ofrece un activo en la pantalla de depósito.
 *
 * - `crypto`: las criptomonedas nativas —`MON`, `ETH`, `SOL`—. Es el camino
 *   "Depositar → Cripto".
 * - `dollar`: las stablecoins —hoy `USDC`—. Es el camino "Depositar → Dólares
 *   digitales".
 *
 * Dos valores y ninguno más: un tercer valor sería una pantalla nueva, y eso se
 * decide en el producto, no acá.
 */
export type DepositAssetKind = 'crypto' | 'dollar';

/** Un activo que se puede recibir en una red. */
export interface DepositAssetSpec {
  /** `MON`, `USDC`, `ETH`, `SOL`. Es la clave con la que se lo busca siempre. */
  readonly symbol: string;
  /** Lo que ve la persona: `Monad`, `Dólares digitales`. */
  readonly name: string;
  /**
   * En qué camino de la pantalla se ofrece este activo: `crypto` o `dollar`.
   *
   * Es el **único** lugar donde se decide qué activos son dólares. Los dos
   * caminos de depósito filtran por este campo, así que un dólar nuevo aparece
   * en la pantalla correcta sin tocar ninguna de las dos.
   *
   * Viaja tal cual en la respuesta de `/api/deposit-info`: es aditivo y no
   * cambia ningún otro campo del activo.
   */
  readonly kind: DepositAssetKind;
  /**
   * Cuántos decimales tiene el token. La pantalla no lo adivina: un exponente
   * equivocado no es una cifra fea, es dinero mal mostrado.
   */
  readonly decimals: number;
  /** `true` para la moneda propia de la red: no hay contrato al que preguntarle. */
  readonly native: boolean;
  /** El contrato en **esta** red, o `null` si el activo es nativo. */
  readonly token: string | null;
  /**
   * ¿Se puede leer el saldo de este token en esta red?
   *
   * `false` **no** significa que no se pueda recibir: significa que todavía no
   * tenemos un lector verificado para él, así que la pantalla lo lista con su
   * red y su dirección y dice que no pudo leer la cifra.
   */
  readonly balanceReadable: boolean;
}

/** Una red en la que se puede recibir, con lo que se puede recibir en ella. */
export interface DepositNetworkSpec {
  readonly chain: DepositChain;
  /** El nombre que ve la persona: `Monad`, `Ethereum`, `Solana`. */
  readonly label: string;
  /**
   * La red EVM en CAIP-2, o `null` si esta red no es EVM.
   *
   * Es la red **en la que la persona opera** (`../wallet/evmNetwork.ts`), no la
   * billetera: la misma dirección EVM sirve en Ethereum y en Monad, y por eso
   * aquí se declara en cada red y no hay una fila por red.
   */
  readonly evmNetwork: EvmNetworkId | null;
  /** Los activos de esta red, en el orden en que se ofrecen. */
  readonly assets: readonly DepositAssetSpec[];
}

/**
 * El catálogo, entero y en un solo lugar.
 *
 * Los cuatro activos de esta primera versión son los cuatro cuyo saldo **sí**
 * sabemos leer. El criterio para sumar uno es el mismo que fija la regla de acá:
 * su contrato verificado en cadena, en la red donde se declara.
 */
export const DEPOSIT_NETWORKS: readonly DepositNetworkSpec[] = [
  {
    chain: 'monad',
    label: 'Monad',
    evmNetwork: 'eip155:143',
    assets: [
      { symbol: 'MON', name: 'Monad', kind: 'crypto', decimals: 18, native: true, token: null, balanceReadable: true },
      {
        symbol: 'USDC',
        name: 'Dólares digitales',
        // Un stablecoin es un dólar digital: va al camino de dólares, no al de
        // cripto. El mismo `kind` en Ethereum, más abajo.
        kind: 'dollar',
        decimals: 6,
        native: false,
        // Verificado en Monad mainnet: contrato con bytecode, `symbol()` = USDC
        // y `decimals()` = 6.
        token: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
        balanceReadable: true,
      },
    ],
  },
  {
    chain: 'ethereum',
    label: 'Ethereum',
    evmNetwork: 'eip155:1',
    assets: [
      { symbol: 'ETH', name: 'Ethereum', kind: 'crypto', decimals: 18, native: true, token: null, balanceReadable: true },
      {
        symbol: 'USDC',
        name: 'Dólares digitales',
        kind: 'dollar',
        decimals: 6,
        native: false,
        // **Otro** contrato. El USDC de Ethereum no es el de Monad: usar el de
        // Monad acá lee un saldo de un contrato que no existe en esta red.
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        balanceReadable: true,
      },
      {
        symbol: 'OUSD',
        name: 'Dólares digitales',
        // Es un stablecoin que rinde solo: entra por el camino de dólares, y su
        // diferencia con USDC no es la categoría sino que el saldo **crece**.
        kind: 'dollar',
        // **18, no 6.** Verificado por `decimals()` contra la RPC de Ethereum:
        // OUSD es un token rebase de 18 decimales, y poner 6 haría que el saldo
        // leído fuera mil millones de veces más chico que el real. Un error de
        // escala acá no se ve como error: se ve como una persona con muy poco.
        decimals: 18,
        native: false,
        // Registry oficial de Origin, sección "Ethereum":
        // https://docs.originprotocol.com/registry/contracts/ousd-registry
        // Verificado por `symbol()` = OUSD y `decimals()` = 18.
        //
        // ── Por qué sólo Ethereum ────────────────────────────────────────────
        //
        // Porque **en Monad no existe**, y declararlo ahí sería la forma más
        // cara de mentir: la app affirmaría "se puede tener OUSD en Monad" sobre
        // una red donde no hay contrato que leer.
        //
        // El registry tiene una sola sección de token, Ethereum. Lo que aparece
        // como "Cross-Chain Strategy (Base)" es una *estrategia* de rendimiento
        // con contrato en las dos redes, no el token: OUSD manda su USDC a Base
        // para prestar contra Morpho, pero el token que la persona tiene vive
        // en Ethereum. Los "OUSD" que aparecen en el explorador de Base tienen
        // un solo holder y un supply máximo de 500 millones: son despliegues de
        // prueba, no el token.
        token: '0x2A8e1E676Ec238d8A992307B495b45B3fEAa5e86',
        balanceReadable: true,
      },
    ],
  },
  {
    chain: 'base',
    label: 'Base',
    evmNetwork: 'eip155:8453',
    assets: [
      { symbol: 'ETH', name: 'Base', kind: 'crypto', decimals: 18, native: true, token: null, balanceReadable: true },
      {
        symbol: 'USDC',
        name: 'Dólares digitales',
        kind: 'dollar',
        decimals: 6,
        native: false,
        // Verificado en chain (bytecode + symbol + decimals), ver el doc de la tarea.
        token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        balanceReadable: true,
      },
      {
        symbol: 'USDT',
        name: 'Dólares digitales',
        kind: 'dollar',
        decimals: 6,
        native: false,
        token: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
        balanceReadable: true,
      },
    ],
  },
  {
    chain: 'arbitrum',
    label: 'Arbitrum One',
    evmNetwork: 'eip155:42161',
    assets: [
      { symbol: 'ETH', name: 'Arbitrum One', kind: 'crypto', decimals: 18, native: true, token: null, balanceReadable: true },
      {
        symbol: 'USDC',
        name: 'Dólares digitales',
        kind: 'dollar',
        decimals: 6,
        native: false,
        token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        balanceReadable: true,
      },
      {
        symbol: 'USDT',
        name: 'Dólares digitales',
        kind: 'dollar',
        decimals: 6,
        native: false,
        token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        balanceReadable: true,
      },
    ],
  },
  {
    chain: 'optimism',
    label: 'OP Mainnet',
    evmNetwork: 'eip155:10',
    assets: [
      { symbol: 'ETH', name: 'OP Mainnet', kind: 'crypto', decimals: 18, native: true, token: null, balanceReadable: true },
      {
        symbol: 'USDC',
        name: 'Dólares digitales',
        kind: 'dollar',
        decimals: 6,
        native: false,
        token: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        balanceReadable: true,
      },
      {
        symbol: 'USDT',
        name: 'Dólares digitales',
        kind: 'dollar',
        decimals: 6,
        native: false,
        token: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
        balanceReadable: true,
      },
    ],
  },
  {
    chain: 'polygon',
    label: 'Polygon',
    evmNetwork: 'eip155:137',
    assets: [
      {
        symbol: 'USDC',
        name: 'Dólares digitales',
        kind: 'dollar',
        decimals: 6,
        native: false,
        token: '0x3c499c542cEF5E3811e1192ce70d8cc03d5c3359',
        balanceReadable: true,
      },
      {
        symbol: 'USDT',
        name: 'Dólares digitales',
        kind: 'dollar',
        decimals: 6,
        native: false,
        token: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        balanceReadable: true,
      },
    ],
  },
  {
    chain: 'solana',
    label: 'Solana',
    evmNetwork: null,
    /*
     * SOL y USDC. El dólar de Solana entró con su **mint** verificado —la misma
     * regla que los contratos de las redes EVM, con la diferencia de que acá la
     * dirección es un mint de un token program y no un contrato— y el camino de
     * dólares lo muestra sin tocar ninguna pantalla.
     *
     * `balanceReadable: true` y **no** por entusiasmo: porque ahora hay un lector.
     * El saldo de un SPL se lee con `getTokenAccountsByOwner` filtrado por este
     * mint, y `readPortfolio` ya lo lee —el mismo puerto del que salen los
     * lamports—. El flag dice una sola cosa, "sabemos leer la cifra de este
     * activo en esta red", y antes de este lector eso era falso: la fila aparecía
     * con su red y su dirección y sin número, o sea que un USDC depositado acá
     * no se veía en ninguna parte de la app.
     */
    assets: [
      { symbol: 'SOL', name: 'Solana', kind: 'crypto', decimals: 9, native: true, token: null, balanceReadable: true },
      {
        symbol: 'USDC',
        name: 'Dólares digitales',
        kind: 'dollar',
        decimals: 6,
        native: false,
        // Mint del USDC de Solana mainnet. **No** es la dirección del USDC de
        // Monad ni el del de Ethereum: son tres identidades distintas, y usar
        // una donde vive otra lee el saldo de un activo que no existe ahí.
        //
        // `readPortfolio` deriva de **esta misma fila** el spec que lee: los
        // mints que se piden son los que el catálogo declara, y el orden de
        // lectura de la cartera es el orden de acá.
        token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        balanceReadable: true,
      },
    ],
  },
];
