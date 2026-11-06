# Controlar la IA de la documentación

[English](../documentation-ai.md)

**Pregunta a la documentación** se puede pausar y activar sin reconstruir ni retirar las guías.
El control abarca las nuevas solicitudes de respuestas y los nuevos embeddings de la documentación.

Es un único control global. Elegir Producción o Staging en el espacio central de administración
no selecciona un estado de IA de documentación separado.

## Pausar o activar las respuestas

En la cabecera de documentación, elige **Administración** cuando se confirme tu sesión como
propietario y abre **IA de documentación**. También puedes abrir el
[espacio central de administración](https://id.meltemi.dev/admin/?lang=es) e iniciar sesión con la
cuenta Meltemi actual del propietario. [Administración y tu cuenta](administration.md) explica
el menú personal, las preferencias y las operaciones autorizadas de los productos.
Solo tienen acceso los `sub` de identidad exactos de la lista existente
`ADMIN_SUBS`; ser administrador o moderador invitado de Meltemi Diagrams no concede acceso a
este control.

Elige **Pausar respuestas** para detener el trabajo nuevo de IA o **Activar respuestas** para
permitirlo otra vez. La página muestra el estado guardado después de la acción. El ajuste se
conserva en la base de datos del servicio de identidad y sigue pausado entre despliegues hasta
que un propietario lo active. Cada cambio comprueba una sesión vigente, la lista de propietarios,
el Origin propio y un token CSRF vinculado a esa sesión.

Las guías y la búsqueda de páginas siguen disponibles en ambos estados. Las solicitudes que ya
se enviaron al proveedor de IA pueden terminar después de pausar; el interruptor no puede retirar
ese trabajo.

## Consultas y compilaciones

El Worker de documentación lee el control antes de generar el embedding de una pregunta y otra
vez antes de pedir una respuesta. Cada lote nuevo de embeddings durante la compilación también
comprueba el estado guardado. Si el control falla, falta o devuelve una respuesta inválida, no
se permiten nuevas llamadas de IA.

Las compilaciones conservan los fragmentos válidos en caché durante la pausa y omiten los que
todavía necesitan un embedding nuevo. Activar las respuestas permite consultar inmediatamente
los fragmentos del índice desplegado. Los fragmentos nuevos o modificados estarán disponibles
tras la siguiente compilación con IA activada. Si una compilación pausada no tiene fragmentos
en caché, se despliega sin el botón Pregunta a la documentación; activar el control no crea su
índice, por lo que hace falta una compilación con IA activada para recuperar el botón y las
respuestas.

Estas direcciones de estado son de solo lectura y no llaman a ningún modelo:

| Dirección                                                    | Resultado                                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [Control de identidad](https://id.meltemi.dev/api/docs-ai)   | `200` con `{"enabled":true}` o `{"enabled":false}`; un ajuste ausente o ilegible devuelve un estado distinto de 200. |
| [Estado del portal](https://docs.meltemi.dev/api/ask/status) | `200` con el mismo booleano o `503` con `{"enabled":false,"reason":"control"}` cuando no se puede leer el control.   |

Ambas respuestas usan `Cache-Control: no-store`. El estado indica si se permite ejecutar IA,
no si hay fragmentos indexados disponibles ni cuánta asignación le queda a la cuenta. El endpoint
de preguntas, `POST /api/ask`, devuelve `503 {"reason":"disabled"}` durante la pausa y
`503 {"reason":"control"}` cuando no puede verificar el control. El diálogo explica el estado
y ofrece la búsqueda de páginas.

## Asignación, facturación y alertas

El interruptor no consulta el plan de Cloudflare, no contabiliza el gasto ni impone un
presupuesto. El límite de diez preguntas por minuto es por dirección IP y no limita el gasto
diario global.

Cloudflare Workers AI incluye **10.000 Neurons diarios por cuenta**, compartidos por las
llamadas a modelos y los embeddings de compilación; se restablecen a las **00:00 UTC**. Con
Workers Free, las llamadas que superan la asignación gratuita fallan. Con Workers Paid, el uso
que supere esa asignación puede generar cargos; el interruptor guardado no pausa automáticamente
cuando cambia el plan de la cuenta. Revisa los
[precios vigentes de Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/)
y el consumo de la cuenta antes de cambiar de plan.

Las [alertas de presupuesto de Cloudflare](https://developers.cloudflare.com/billing/manage/budget-alerts/)
avisan cuando el gasto cruza un umbral. Una alerta no pausa el consumo ni limita los cargos.

## Otros usos de Meltemi

Este control se aplica al portal de documentación alojado y sus compilaciones de embeddings.
No afecta a Meltemi Diagrams ejecutado localmente con Docker Compose, a su servidor MCP local
ni a los modelos de un agente externo como Claude Code o Codex. Esos agentes mantienen su propia
configuración de modelos, cuenta y facturación.
