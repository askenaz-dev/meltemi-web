# Administración y tu cuenta

[English](../administration.md)

El [espacio de administración de Meltemi](https://id.meltemi.dev/admin/?lang=es) reúne los controles
de servicio de la familia, las operaciones autorizadas de Diagrams y las páginas de tu cuenta en
una aplicación. Inicia sesión con tu cuenta Meltemi actual. Cada sección y acción comprueba tu
acceso vigente.

## Abrirlo desde la documentación

La cabecera de documentación siempre ofrece **Cuenta**. Los lectores con sesión iniciada tienen
un menú con **Perfil**, **Preferencias**, **Seguridad de la cuenta** y **Cerrar sesión**. Un
propietario del servicio confirmado también ve **Administración** directamente en la cabecera,
incluso desde un teléfono. Ese enlace abre el espacio central en el idioma de la página de
documentación.

Solo las identidades exactas de propietarios incluidas en `ADMIN_SUBS` ven esta entrada en
documentación. Un administrador o invitado de Diagrams conserva el acceso que le concede el
producto; ese rol no concede el control de IA de documentación reservado a los propietarios.

La cabecera comprueba la navegación personal mediante una solicitud privada al mismo origen.
Retira la navegación privilegiada anterior antes de actualizarla y cuando cambia la cuenta.
Si la comprobación falla, permanece el enlace genérico Cuenta y siguen funcionando las guías y
la búsqueda de páginas.

## Cuenta personal

Estas páginas están disponibles para cualquier cuenta con sesión iniciada:

| Página                                                             | Qué cambia                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [Perfil](https://id.meltemi.dev/account/profile?lang=es)           | Tu nombre visible preferido. Al borrarlo, se recupera el nombre del proveedor con el que inicias sesión. |
| [Preferencias](https://id.meltemi.dev/account/preferences?lang=es) | Apariencia (`system`, `light`, `dark`) e idioma (`system`, `en`, `es`) de la aplicación central.         |
| [Seguridad de la cuenta](https://id.meltemi.dev/account?lang=es)   | Proveedores de inicio de sesión vinculados, sesiones activas y las acciones existentes de seguridad.     |

Las preferencias se guardan con tu cuenta. Elegir explícitamente el idioma de una página tiene
prioridad sobre el idioma guardado; Sistema sigue al navegador. El lector de documentación
mantiene sus propios controles de apariencia e idioma, y las opciones de los editores permanecen
en sus respectivos productos.

**Cerrar sesión** abre la página de confirmación de Identity. Si se abre desde el menú de cuenta
de documentación, vuelve a la guía pública después de confirmar.

## Operaciones de servicio y Diagrams

Usa el selector **Producción** / **Staging** para elegir el entorno de Diagrams. Su acceso,
permisos, patrocinios, publicaciones y actividad reciente pertenecen al backend seleccionado;
comprueba esa selección antes de enviar un cambio de producto. Los ajustes personales son
compartidos. El control de IA de documentación es global y conserva el mismo estado guardado
en ambas selecciones.

El espacio muestra las secciones permitidas por tu condición de propietario del servicio y tu
rol vigente en Diagrams. El producto tramita los cambios con sus permisos y registros de
auditoría existentes.

| Sección                                                                      | Trabajo disponible                                                                                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [IA de documentación](https://id.meltemi.dev/admin/docs-ai?lang=es)          | Los propietarios pausan o activan el trabajo nuevo de IA. Consulta [la guía del control](documentation-ai.md).                    |
| [Acceso](https://id.meltemi.dev/admin/diagrams/access?lang=es)               | Revisa administradores e invitaciones; invita, revoca, acepta o rechaza, retira acceso o abandona la administración según tu rol. |
| [Permisos](https://id.meltemi.dev/admin/diagrams/permissions?lang=es)        | Resuelve una cuenta exacta y consulta o cambia las concesiones explícitas. El acceso derivado del rol aparece por separado.       |
| [Patrocinios](https://id.meltemi.dev/admin/diagrams/sponsorships?lang=es)    | Revisa los patrocinios y resuelve las cuentas sin vincular antes de otorgarles un permiso explícito.                              |
| [Publicaciones](https://id.meltemi.dev/admin/diagrams/publications?lang=es)  | Retira una dirección publicada concreta con confirmación explícita y motivo.                                                      |
| [Actividad reciente](https://id.meltemi.dev/admin/diagrams/activity?lang=es) | Revisa las cincuenta entradas más recientes de auditoría administrativa.                                                          |

La consulta de cuentas utiliza un identificador o correo exacto, sin ofrecer un directorio para
explorar. Cada formulario comprueba la sesión vigente, el permiso para la acción solicitada, el
Origin de Identity y un token CSRF vinculado a la sesión. No hace falta crear ni copiar un token
de API en el navegador.

Si Diagrams no está disponible temporalmente, su sección muestra una opción para reintentar.
Las páginas personales y el control de IA de documentación siguen siendo independientes de esa
conexión. La configuración del despliegue se muestra cuando la proporciona el producto.
