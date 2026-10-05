# Captures del producto (`public/product`)

Esta carpeta existe porque la landing muestra **una sola captura real** y deja
los demás huecos marcados. No hay mockups, ni ilustraciones, ni "wireframes" que
hagan de pantalla: un dibujo de pantalla es una afirmación falsa con mejor
superficie.

La sección que las consume es `components/showcase-section.tsx`. Sus textos
vienen de `copy.showcase` en `components/language-provider.tsx` (ES / EN / PT);
aquí abajo solo están los archivos.

## Reglas para capturar

- Mismo ancho que `01-entrar.png`: **390 px** (iPhone 12/13/14 lógico), así
  todas las capturas se ven iguales en la grilla.
- Sin datos reales: nada de saldos, correos, identificadores `@nombre` ni
  códigos QR que apunten a una cuenta viva.
- Sin números en pantalla que la landing no pueda sostener (tasas, cantidades,
  comisiones, saldos con cifras).
- Nombre de archivo: `NN-slug.png`, en el orden en que se agrega la fila.

## Lo que falta capturar

| Archivo | Pantalla | Qué tiene que mostrar |
| --- | --- | --- |
| `01-entrar.png` | Entrar | Ya está. Pedir el correo, avisar el código y que la cuenta se crea sola. |
| `02-saldo.png` | Saldo | La pantalla de inicio: el saldo y los botones de enviar, recibir y link de cobro. |
| `03-enviar.png` | Enviar por @nombre | Escribir el identificador de la otra persona, revisar el envío y confirmarlo. |
| `04-link-cobro.png` | Link de cobro | El link listo para compartir como mensaje. |
| `05-actividad.png` | Actividad | Los movimientos agrupados por fecha, entradas y salidas juntas. |

## Cómo agregar una captura

1. Guardar el archivo acá con el nombre de la tabla.
2. En `components/language-provider.tsx`, en `copy.showcase.screens`, cambiar la
   fila correspondiente para que use la captura en vez del texto de pendiente.
3. Si el texto de la pantalla o su `alt` cambian, actualizarlos en **los tres
   idiomas** (es / en / pt) en el mismo paso.

Nunca borrar el `01-entrar.png`: es la única prueba real de que la app existe.