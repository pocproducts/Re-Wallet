# El modelo de saldo de la liquidación interna

> Documento de diseño. **No implementa nada.** Describe qué tiene que ser verdad
> para que "sin comisión e instantáneo" deje de ser una promesa y pase a ser un
> hecho respaldado por un número.

## Por qué este documento existe

El 2026-10-11 el producto decidió que el envío por ReWALLET mueve plata **por
dentro** y liquida contra la cadena **agrupado** (`batch`). Eso hace las dos
promesas literalmente ciertas, y a cambio obliga a responder una pregunta que el
envío on-chain nunca tuvo que responder:

> Si la plata se acredita sin moverse, **¿de quién es la plata mientras no se mueve?**

Esa pregunta es el documento.

---

## 1. El problema, con números

Dos personas con USDC en Monad. Esto es real, está en la cadena:

```
vos: 100 USDC        Ana: 50 USDC
```

Vos le mandás **30** a Ana. Instantáneo, sin comisión, sin transacción:

```
vos:  70 USDC        Ana: 80 USDC       ← el saldo que SIENTEN
vos: 100 USDC        Ana: 50 USDC       ← el saldo que EXISTE en la cadena
```

Los dos renglones son ciertos al mismo tiempo. **Nadie se movió todavía: solo se
anotó un crédito.**

A los 5 minutos el batch hace **una sola transacción** que mueve 30 de tu wallet
a la de Ana, y los renglones se vuelven uno. Ese hueco de cinco minutos es todo
el problema.

### El nudo

Mientras tanto **los 30 de Ana están en tu wallet**, no en la suya. Si Ana
pidiera retirarlos, estarías sacando plata que no está. Y si puede pedir un
retiro de 80 cuando solo tiene 50, el sistema le promete plata que no puede
entregar.

## 2. Por qué no alcanza con un saldo

Es inevitable. La plata tiene que existir en algún lado **antes** de moverse, y
sólo puede estar en un lado por persona. Un solo saldo obliga a mentir sobre una
de las dos verdades:

| Si mostrás | El problema |
|---|---|
| El **total** (80 para Ana) | Ana ve plata que no puede retirar. Se queja cuando no llega. |
| El **disponible** (50 para Ana) | Ana no ve los 30 que le mandaste. Se queja más fuerte, porque le cobrás por cobrar. |

Es el mismo motivo por el que un banco muestra dos números.

## 3. Los dos saldos

| | Qué es | Dónde vive | Qué puede hacer la persona |
|---|---|---|---|
| **Total** | Lo que la persona **siente** que tiene. Es el número grande de la pantalla. | Base de ReWALLET, derivado de `movements` | Mandar a otra persona de ReWALLET |
| **Disponible** | Lo que puede **mover a la cadena ahora mismo**. | Derivado: `real − pendientes` | Depositar en un exchange, retirar, mover |

Y para cada persona:

```
vos:  total  70  ·  disponible  70   (no mandaste nada pendiente)
Ana:  total  80  ·  disponible  50   (tiene 30 pendientes de vos)
```

## 4. El invariante

Una sola regla hace que todo el modelo sea seguro:

> **`disponible ≤ saldo real en la cadena`**

Es decir: `disponible = real_onchain − pendiente_de_entrantes`.

- La plata que **vos** mandaste y que **Ana** ya tiene: se resta de tu disponible, porque todavía está en tu wallet.
- La plata que **vos** tenés y nadie te mandó: sigue disponible, porque está en tu wallet y podés moverla.

Si alguna vez `disponible > real`, se inventó plata. **Ese es el número que hay que testear en cada operación, y el que ninguna implementación puede saltarse.**

## 5. Lo que esto le hace a `withdraw`

Acá está la trampa, y es el cambio más profundo del modelo.

Con liquidación interna, **retirar deja de ser un envío**. Pasa a ser un retiro
de **saldo disponible**:

```
Ana pide retirar 80
  → disponible de Ana = 50
  → se le liquidan 50 ahora
  → los 30 quedan pendientes hasta el batch
```

El caso límite: **Ana pide retirar 100 y solo tiene 50 disponibles.** No se
rechaza el retiro entero —eso sería una app que te dice que tu plata no existe—,
sino que se le **cumple lo disponible** y se le explica que el resto se activa
cuando su saldo se liquide.

## 6. La decisión: qué pasa si el batch falla

**DECIDIDO: diferir.** Es la decisión del producto y cierra el diseño.

Las tres salidas eran distintas entre sí:

| Salida | Qué significa | Qué cuesta |
|---|---|---|
| ~~Diferir~~ ✅ | El pendiente espera al siguiente batch. La plata está acreditada y no se mueve todavía. | El usuario tiene saldo que no puede mover. Hay que decirlo en pantalla. |
| Escalar | Se cobra comisión para pagar la red del batch. | **"Sin comisión" pasa a ser falso.** Invalida la decisión de producto. |
| Deuda interna | ReWALLET asume la diferencia y liquida con su propia reserva. | Solo viable con reserva sobre el volumen, y es riesgo de solvencia. |

### Por qué diferir

1. **Es la única que no invalida el producto.** "Sin comisión" es una promesa que
   el producto acaba de empezar a cumplir de verdad (ver `copy-honesto.md`).
   Escalar la rompería en la primera congestión de la red, que es un día normal.
2. **Es la más segura de implementar.** La plata del usuario **nunca se usa para
   otra cosa**: ReWALLET agrupa transacciones, no explicaciones de fondos. Si la
   red falla, se reintenta y no hay pérdida: hay espera.
3. **El costo es visible y el de las otras es oculto.** Un usuario que espera
   cinco minutos sabe qué pasó. Un saldo que aparece y desaparece es peor.

### Qué implica en la tabla

La tabla de créditos necesita la columna `state` con al menos:

```
state = 'pending'    acreditado, todavía en la wallet del emisor
state = 'settled'    liquidado por el batch, ya está en la cadena
state = 'failed'     el batch no pudo liquidarlo
```

Y una regla de reintento: `failed` vuelve a `pending` en el próximo intento,
sin tocar el crédito del receptor. **Un reintento no vuelve a acreditar nada** —
es el mismo crédito, con más espera.

### Qué hay que decir en pantalla

Un `pending` largo **se dice**. Es la diferencia entre una espera y un fallo, y
es exactamente el tipo de verdad que el README del proyecto promete:

> Si no se pudo mover todavía, se dice que todavía no se movió.

El número que hay que mostrar: *"Recibido. Se activa cuando tu envío se
liquide — normalmente en menos de 5 minutos."*

## 7. La secuencia de trabajo

No es una lista de deseos: cada paso depende de que el anterior sea verdad.

1. ~~**Decidir el punto 6.**~~ **Hecho: diferir.** Ya no bloquea nada.
2. **Tabla de créditos internos.** Un asiento por envío entre dos usuarios de
   ReWALLET, con `from_user`, `to_user`, `amount`, `asset`, `chain`, `state`
   (`pending` | `settled` | `failed`) y una marca de cuándo se liquidó.
3. **El envío por tag escribe en esa tabla** en vez de preparar una transacción.
   El hook de firma del navegador desaparece para ese camino: no hay nada que
   firmar, porque no hay transacción.
4. **`readPortfolio` pasa a devolver los dos saldos**, y la pantalla muestra el
   total grande con el disponible debajo.
5. **`withdraw` pasa a consumir disponible**, y su caso límite es el del punto 5.
6. **El worker de batch** agrupa los `pending`, prepara una transacción por
   cadena, y marca `settled`. Un fallo marca `failed` y reintenta al siguiente
   ciclo, sin re-acreditar.
7. **Reconciliación**: un job que compare el real de la cadena contra
   `disponible` calculado y avise si se desvían. Es el que detecta plata
   inventada.
8. **Recién ahora se restaura el copy** de "instantáneo".

## 8. Lo que este modelo hereda

Decisiones ya tomadas y que hay que respetar:

- La política de gasto sigue aplicando. Un envío interno también la cumple:
  `evaluateSendPolicy` no distingue el modo, y no debe.
- La idempotencia por `requestId` se mantiene. Un crédito interno duplicado es
  plata duplicada.
- El tag resuelve identidad por `users.tag_normalized`, igual que hoy.
- El movimiento en Actividad debe distinguir el modo, como ya distingue
  `recipientTag`: un envío interno no tiene hash de transacción, y una pantalla
  que muestra un hash vacío se rompe.

## 9. Lo que este modelo NO es

- **No es custodia en el sentido regulatorio**: ReWALLET no recibe los fondos
  del usuario en una cuenta propia. La plata sigue en las wallets de cada uno;
  lo que se agrupan son transacciones, no explicaciones de fondos.
- **No es un exchange**: no hay precios, ni órdenes, ni contrapartes.
- **No es instantáneo para el saldo liquidado.** Es instantáneo para el
  **crédito**. Esa distinción tiene que estar escrita en la pantalla, porque es
  la diferencia entre una promesa y una verdad.