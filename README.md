# Consultas Panadería

Aplicación local de escritorio para consultar ventas de la API D3XD, revisar el movimiento de caja y preguntar sobre los datos mediante un modelo local de LM Studio.

## Desarrollo

1. Instala Node.js LTS.
2. Ejecuta `npm install`.
3. Ejecuta `npm run dev`.
4. Configura la URL base de la API y el token desde el botón de configuración. El token se cifra con el almacenamiento seguro de Windows.
5. Inicia LM Studio, carga un modelo y habilita su servidor local compatible con OpenAI (por defecto `http://127.0.0.1:1234/v1`).

La app consulta `check_status.php`, `consultar_pedidos.php` y `consultar_productos.php` automáticamente. El intervalo inicial es de 30 segundos y se puede ajustar entre 10 y 300 segundos.

## Alcance inicial

- Las peticiones a la API se hacen en el proceso principal de Electron; el token no se expone a la interfaz.
- Se usa únicamente la API de lectura para alimentar el panel. No se invocan endpoints de escritura o borrado.
- El panel muestra efectivo, crédito y débito cuando los pagos de la API están clasificados con esos nombres.
- El fondo inicial, entradas, retiros y conteo de efectivo se guardan localmente para el día. La disponibilidad del cierre Z en la API queda pendiente de confirmación con una respuesta de la instalación remota.
- Las ventas por período se agrupan usando el campo de fecha que llegue en cada pedido. Si no se reconoce un campo de fecha, el panel lo informa en lugar de asignar ventas a un período incorrecto.
- La proyección inicial es un promedio simple, visible como tal y no como pronóstico estadístico.
- El chat es plegable y envía el contexto de consultas solo a LM Studio en este equipo.

## Verificación de datos

Antes de depender del panel para cierres, comprobar contra la instancia remota:

- El campo exacto y zona horaria de la fecha de venta.
- Los valores reales de `wtipopago` para efectivo, tarjeta de crédito y tarjeta de débito.
- La moneda (`widmoneda`) asociada a cada pago.
- Si existe un endpoint adicional para obtener el cierre Z.
