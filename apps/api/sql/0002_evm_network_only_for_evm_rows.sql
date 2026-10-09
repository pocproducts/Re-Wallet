-- 0002 — la red EVM es de las filas EVM, y de ninguna otra.
--
-- Qué pasó: 0001 agregó `evm_network` con `DEFAULT 'eip155:1'` y `NOT NULL`.
-- Ese default se aplicó también a la fila de Solana, así que nuestra base
-- decía que una wallet de Solana estaba en Ethereum mainnet. No era un valor
-- inútil: era una respuesta falsa, y una base que miente se corrige con una
-- migración, no con unScripts en el backend que la esquive.
--
-- Por qué una columna y no una fila por red: la misma dirección EVM sirve en
-- todas las redes EVM configuradas. Una fila por red rompería el UNIQUE de
-- `address`. La red en uso es una propiedad de la sesión.
--
-- Idempotente: se puede correr las veces que haga falta.

ALTER TABLE rewallet.wallets ALTER COLUMN evm_network DROP NOT NULL;

-- Toda fila que no sea EVM deja de afirmar una red EVM.
UPDATE rewallet.wallets
   SET evm_network = NULL
 WHERE chain_type <> 'ethereum'
   AND evm_network IS NOT NULL;

COMMENT ON COLUMN rewallet.wallets.evm_network IS
 'Red EVM en la que opera la wallet, en CAIP-2 (eip155:1, eip155:143). NULL para filas que no son EVM (Solana). Es una columna y no una fila por red porque la misma direccion EVM sirve en todas las redes EVM configuradas.';