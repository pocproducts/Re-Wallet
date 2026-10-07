/**
 * LECTURA DE AAVE EN MONAD — verificación de una sola vez, fuera de la app.
 *
 * No es código de la aplicación: es la comprobación que justifica las
 * direcciones que T5 va a usar. Corre con `node aave-check.mjs` desde
 * `05. UI-UX` y se borra después.
 *
 * Las direcciones salen del paquete oficial `@aave-dao/aave-address-book`, y
 * se cross-chequean contra el propio aToken, que es un contrato que existe
 * probadamente porque tiene saldo de una persona.
 *
 * Para leer tasas se usa `AaveProtocolDataProvider`, no el `Pool`: sus getters
 * son planos. `Pool.getReserveData` devuelve un struct **packed** (varios
 * `uint128` en una misma palabra) y leerlo palabra por palabra dio un APR de
 * 2.28e+83%: número que parece una tasa y no lo es. Un API plano no se
 * interpreta, se deserializa.
 */
import { createPublicClient, http, parseAbi, decodeAbiParameters, formatUnits } from 'viem';
import { defineChain } from 'viem';

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
});

// Del address book oficial de Aave (@aave-dao/aave-address-book, AaveV3Monad).
const POOL = '0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef';
const DATA_PROVIDER = '0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad';
const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const A_USDC = '0x35a73BAcb179d3740395A3ceCc87FF2e581d6042';
const WALLET_WITH_POSITION = '0xcCbe254F1Ada7AE89270ecf41D09EBEA68f267a6';

const client = createPublicClient({ chain: monad, transport: http() });

const erc20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);
const aTokenAbi = parseAbi(['function POOL() view returns (address)']);
const providerAbi = parseAbi([
  // ABI tomado del codigo fuente oficial de Aave v3
  // (contracts/misc/AaveProtocolDataProvider.sol): 12 salidas, en este orden.
  // Una version anterior de este archivo declaraba 6 con otro orden y todo
  // salia desalineado: un lastUpdateTimestamp de 4e25 y tasas en cero.
  'function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)',
  'function getAllReservesTokens() view returns (address[])',
]);

const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31536000n;
/*
 * La tasa almacenada es ANUAL en RAY, no por segundo. Tratarla como por segundo
 * daba 130.281.299% de APR. Con la conversion correcta el numero tiene sentido
 * y es coherente con el resto: supply por debajo de borrow, con un spread chico
 * a una utilizacion apenas arriba del kink.
 */
const aprFromRay = (annual) => (Number((BigInt(annual) * 10000n) / RAY) / 100).toFixed(2);

console.log('--- 1. Las direcciones, contra el contrato que tiene saldo ---');
console.log(`POOL (address book):      ${POOL}`);
console.log(`POOL (dice aMonUSDC):    ${(await client.readContract({ address: A_USDC, abi: aTokenAbi, functionName: 'POOL' })).toLowerCase()}`);
console.log(`aMonUSDC:                ${await client.readContract({ address: A_USDC, abi: erc20, functionName: 'symbol' })}`);

console.log('\n--- 2. La posicion que ya existe (wallet de pruebas anterior) ---');
const pos = await client.readContract({ address: A_USDC, abi: erc20, functionName: 'balanceOf', args: [WALLET_WITH_POSITION] });
const free = await client.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [WALLET_WITH_POSITION] });
console.log(`depositado: ${formatUnits(pos, 6)} aMonUSDC`);
console.log(`libre:      ${formatUnits(free, 6)} USDC`);

console.log('\n--- 3. El pool lista nuestro USDC? ---');
const reserves = await client.readContract({ address: DATA_PROVIDER, abi: providerAbi, functionName: 'getAllReservesTokens' });
// OJO: devuelve los aTokens, no los underlying. Compararlo contra el USDC
//underlying da "NO esta listado" sobre una reserva que si esta.
console.log(`reservas: ${reserves.length}`);
console.log(`nuestro aMonUSDC esta listado: ${reserves.some((r) => r.toLowerCase() === A_USDC.toLowerCase()) ? 'SI' : 'NO'}`);
console.log(`aTokens: ${reserves.join(', ')}`);

console.log('\n--- 4. La tasa real, leida con la API plana del DataProvider ---');
const [, , totalAToken, , totalVariableDebt, liquidityRate, variableBorrowRate, , , , , lastUpdate] =
  await client.readContract({ address: DATA_PROVIDER, abi: providerAbi, functionName: 'getReserveData', args: [USDC] });
const totalSupply = totalAToken;
console.log(`total depositado:    ${formatUnits(totalSupply, 6)} USDC`);
console.log(`deuda variable:      ${formatUnits(totalVariableDebt, 6)} USDC`);
console.log(`utilizacion:         ${(Number((totalVariableDebt * 10000n) / (totalSupply || 1n)) / 100).toFixed(2)}%`);
console.log(`liquidityRate (crudo): ${liquidityRate}`);

console.log(`borrow APR:          ${aprFromRay(variableBorrowRate)}%`);
const secs = Number(lastUpdate);
console.log(`ultima actualizacion: ${Number.isFinite(secs) && secs > 1e9 ? new Date(secs * 1000).toISOString() : `sin dato (${lastUpdate})`}`);

console.log('\n--- 5. Cuanto renderia la posicion existente en un año ---');
const deposited = pos;
const aprFraction = Number((BigInt(liquidityRate) * 10000n) / RAY) / 10000;
const growth = formatUnits((deposited * BigInt(Math.round(aprFraction * 1e6))) / BigInt(1e6), 6);
console.log(`si ${formatUnits(deposited, 6)} sigue depositado un año: +${growth} aMonUSDC (a ${aprFromRay(liquidityRate)}% APR)`);