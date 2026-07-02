export const onRequest: PagesFunction<{}> = async (context) => {
  const url = new URL(context.request.url);
  const workerUrl = `https://blog_website.${context.env.ACCOUNT_ID || 'your-subdomain'}.workers.dev${url.pathname}${url.search}`;

  const newRequest = new Request(workerUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
  });

  const response = await fetch(newRequest);

  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', url.origin);
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
};