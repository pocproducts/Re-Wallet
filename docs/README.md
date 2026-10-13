# Documentación

Cada carpeta responde una pregunta distinta. Mezclarlas en un solo directorio
es lo que hace que un repo con mucha documentación termine sin que nadie la lea.

| Carpeta | Responde |
|---|---|
| [`contratos/`](contratos/) | ¿Qué reglas no se rompen? |
| [`decisiones/`](decisiones/) | ¿Qué descubrimos, y cuándo? |
| [`auditorias/`](auditorias/) | ¿Qué se revisó? |

## contratos

Las reglas de diseño del proyecto. Se escribieron **antes** que el código y no
se negocian: si una implementación las contradice, la implementación está mal.

- [`dinero.md`](contratos/dinero.md)
- [`identidad.md`](contratos/identidad.md)
- [`interfaz.md`](contratos/interfaz.md)
- [`nucleo.md`](contratos/nucleo.md)

## decisiones

Hallazgos que cambiaron el rumbo, con **cómo se verificaron**. Un hallazgo que
no dice cómo se comprobó es una afirmación.

- [`swap-monad-estado-y-bloqueo.md`](decisiones/swap-monad-estado-y-bloqueo.md)
  — Monad no tiene QuoterV2 desplegado, y qué se hizo con eso.

## auditorias

Revisiones técnicas del MVP.

- `Auditoría técnica Wallet MVP.md`
- `Cloudflare wallet MVP.md`

## Carpetas vacías

Existen en disco porque alguien las creó y todavía no hay nada que poner. **No
figuran en la tabla de arriba**: una tabla que anuncia directorios vacíos le
enseña al que abre el repo una lista de huecos, y el hueco se lee como promesa
incumplida. Una carpeta entra a la tabla el día que tiene contenido.

- `arquitectura/` — el system design con su diagrama
- `producto/` — roadmap y requerimientos
- `assets/` — el gif o el video del producto

Si vas a borrar una: verificá antes con `git ls-files docs/<carpeta> | wc -l`.
Cero archivos versionados significa que borrarla no pierde nada.