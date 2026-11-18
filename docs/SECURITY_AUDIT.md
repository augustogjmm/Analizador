# Estado de seguridad e historial público — Analizador

Revisión de alcance limitado del 18 de noviembre de 2026. Los hallazgos son hechos observados mediante el conector de GitHub y búsquedas de patrones; **no son una certificación de ausencia de secretos o vulnerabilidades**.

## Hallazgos verificables

- El commit inicial `e4054f6c746ac0b3dd1e6ce88aa44c7da3bb759f` contenía cachés de npm y Vite, incluidos aproximadamente 1.120 archivos de contenido de caché npm.
- Se retiraron `.npm-cache/` y `.vite/` del árbol actual y se agregaron exclusiones en `.gitignore`. El historial antiguo sigue siendo accesible mediante los commits históricos.
- La revisión previa de archivos TypeScript, rutas API, documentación y los archivos de logs npm identificados no encontró coincidencias con los patrones de credenciales comprobados. No se recorrieron exhaustivamente todas las entradas binarias y empaquetadas del historial.
- Se añadió `.github/dependabot.yml` para proponer revisiones de dependencias y workflows, además de un workflow independiente de lint y TypeScript.
- `SECURITY.md` documenta el canal de reporte responsable.

## Riesgo pendiente

Los archivos retirados del árbol actual pueden seguir descargándose desde commits antiguos. Una limpieza de historial es diferente de borrar directorios y **requiere reescritura de commits y actualización forzada de referencias**, lo cual puede invalidar enlaces o clones existentes.

## Saneamiento recomendado

1. Obtener un clon de trabajo independiente del repositorio y una copia de respaldo local verificable del historial original.
2. Confirmar que nadie más está aportando cambios y revisar el estado del commit actual antes de intervenir.
3. Usar `git filter-repo` desde una copia nueva para excluir `.npm-cache/` y `.vite/` de todo el historial. Comparar el árbol final con la rama vigente, conservando código y documentación.
4. Hacer un push con control de concurrencia (`--force-with-lease`) únicamente después de validar la copia saneada. Prever actualización de clones antiguos.
5. Comprobar el historial remoto posterior y, si se requiere eliminación completa de objetos sensibles accesibles por SHA u otras referencias, seguir las pautas de soporte de GitHub.
6. Si aparecen credenciales reales, revocarlas y rotarlas sin esperar a terminar la limpieza del historial.

## Fuera del alcance confirmado

- No se ejecutó un escaneo exhaustivo de todos los blobs binarios del historial ni una auditoría de dependencias a nivel de CVE.
- No se revisó la configuración administradora de secret scanning, push protection o alertas privadas de Dependabot; la conexión de GitHub usada no ofrece esos controles.
- No se comprobó un despliegue productivo de la aplicación Liquidity Lab.

**Estado:** árbol actual limpiado; historial histórico sin sanear; controles de CI y mantenimiento añadidos. No declarar la auditoría de seguridad como cerrada.
