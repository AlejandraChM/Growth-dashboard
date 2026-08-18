# Dashboard de reuniones Calendly

## Estructura
- `public/index.html` — el dashboard (frontend), sin token, ya conectado
- `api/events.js` — función serverless que llama a Calendly usando el token guardado en el servidor

## Cómo desplegar en Vercel

1. Sube esta carpeta a un repo de GitHub (o usa `vercel` CLI directo desde aquí).
2. En Vercel, importa el proyecto.
3. Antes de desplegar, agrega la variable de entorno:
   - **Name:** `CALENDLY_TOKEN`
   - **Value:** tu Personal Access Token de Calendly
   - Ve a Project Settings → Environment Variables, agrégala para "Production" (y "Preview"/"Development" si quieres probar antes).
4. Despliega. Tu equipo entra al link y el dashboard ya carga las reuniones directamente, sin pedir ningún token.

## Notas de seguridad
- El token nunca viaja al navegador — solo vive en el servidor de Vercel como variable de entorno.
- Si compartes el link con tu equipo, cualquiera con acceso puede ver todas las reuniones de tu cuenta de Calendly. Si necesitas restringir el acceso, considera:
  - Protección con contraseña de Vercel (disponible en planes Pro)
  - O agregar una capa simple de autenticación en `api/events.js` (por ejemplo, verificar un header secreto compartido con tu equipo)
