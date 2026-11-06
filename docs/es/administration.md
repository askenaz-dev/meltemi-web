# Usar la administración

[English](../administration.md)

El [espacio de administración](https://id.meltemi.dev/admin/?lang=es) está destinado a los
propietarios del servicio y a las personas invitadas a administrar Diagrams. Muestra las secciones
que permite tu rol vigente. Para los ajustes personales, usa [la guía de tu cuenta](account.md).

## Abrir el espacio de trabajo

Inicia sesión con la cuenta Meltemi que tiene tu rol. Abre **Administración** desde el menú de
cuenta del producto o usa el enlace anterior. Los propietarios del servicio también ven
**Administración** en la cabecera de documentación cuando se confirma su cuenta.

Comprueba **Entorno de Diagrams** antes de cambiar datos del producto: **Producción** afecta al
servicio en uso; **Staging** es su entorno de pruebas separado. Los roles, invitaciones, permisos,
patrocinios, publicaciones y actividad pertenecen al entorno seleccionado. Los ajustes personales
son compartidos y el control de IA de documentación es global.

## Roles e invitaciones

Abre [Roles e invitaciones](https://id.meltemi.dev/admin/diagrams/access?lang=es).

- Los propietarios pueden invitar administradores, revocar invitaciones pendientes y retirar
  roles administrativos.
- Los administradores pueden abandonar su propio rol con **Dejar la administración**.
- Una persona invitada puede aceptar o rechazar la invitación después de iniciar sesión con el
  correo verificado al que se la invitó.

Para invitar a alguien, escribe su correo y elige **Invitar administrador**. No se envía un correo
de invitación: pide a esa persona que abra el espacio de administración. Las invitaciones vencen
en siete días. La página admite hasta veinte administradores y diez invitaciones pendientes.
Retirar un rol requiere la confirmación que muestra el formulario.

## Permisos de cuentas y patrocinios

En [Permisos de cuentas](https://id.meltemi.dev/admin/diagrams/permissions?lang=es), escribe el ID de
cuenta, identificador de Meltemi o correo verificado exacto y elige **Buscar cuenta**. Comprueba la
persona resuelta antes de elegir **Otorgar permiso** o **Revocar permiso explícito**. Si varias
cuentas comparten un correo, pide a la persona su ID de cuenta.

**Permiso explícito** y **Acceso efectivo** son diferentes: los propietarios y administradores
ya reciben los permisos de Diagrams mediante su rol. Revocar un permiso explícito no retira el
acceso de ese rol.

Usa [Patrocinios](https://id.meltemi.dev/admin/diagrams/sponsorships?lang=es) para revisar los
registros recientes. Si un patrocinio no está vinculado, resuelve primero la cuenta Meltemi que
proporciona la persona antes de otorgarle un permiso. El usuario de GitHub puede diferir del
identificador de Meltemi. Cancelar un patrocinio conserva un permiso de exportación existente;
gestiona por separado los cambios de permisos.

## Moderar una publicación

1. Abre [Moderación de publicaciones](https://id.meltemi.dev/admin/diagrams/publications?lang=es).
2. Escribe la dirección exacta de la publicación o su `handle/slug` en el host de publicación
   mostrado.
3. Añade un motivo si hace falta, marca la confirmación y elige **Retirar publicación**.

La operación actúa sobre una publicación, sin ofrecer un directorio de páginas publicadas. Su
propietario ve que el servicio la retiró. Comprueba el entorno seleccionado y la dirección antes
de confirmar.

[Actividad reciente](https://id.meltemi.dev/admin/diagrams/activity?lang=es) muestra las cincuenta
acciones administrativas registradas más recientes, incluidas invitaciones, cambios de permisos
y retiradas de publicaciones.

## Pausar o activar la IA de documentación

Los propietarios del servicio pueden abrir
[IA de la documentación](https://id.meltemi.dev/admin/docs-ai?lang=es), que aparece también como
**Respuestas con IA** en la navegación del espacio de trabajo. Un rol de administrador de
Diagrams no concede este control por sí solo.

Elige **Pausar respuestas** o **Activar respuestas** y comprueba el estado guardado. La pausa
detiene el trabajo nuevo de IA; las solicitudes en curso pueden terminar. El estado se conserva
entre despliegues. Se aplica al portal de documentación en todos los entornos, independientemente
del selector de entorno de Diagrams.

Las guías y la búsqueda de páginas siguen disponibles cuando las respuestas están pausadas o no
están disponibles. Este control no configura los modelos de agentes de programación externos ni
los de la asistencia local de Diagrams.

## Si una acción no funciona

Si no se puede contactar con Diagrams, elige **Volver a intentar**. Los ajustes de cuenta y el
control de IA de documentación pueden seguir disponibles mientras el producto no lo está. Si no
se puede verificar un formulario, recarga la página y vuelve a intentarlo; comprueba el estado
actual antes de enviar otra vez la acción.

Si falta una sección o una dirección muestra **No encontrado**, comprueba qué cuenta tiene la
sesión iniciada y si su rol administrativo sigue vigente. Iniciar sesión no concede por sí solo
un rol administrativo.
