globalThis.process ??= {}; globalThis.process.env ??= {};
import './chunks/astro-designed-error-pages_Dnm4g8PS.mjs';
import './chunks/astro/server_Dtj_OyDT.mjs';
import { s as sequence } from './chunks/render-context_DSxxJ_uY.mjs';

const onRequest$1 = (context, next) => {
  if (context.isPrerendered) {
    context.locals.runtime ??= {
      env: process.env
    };
  }
  return next();
};

const onRequest = sequence(
	onRequest$1,
	
	
);

export { onRequest };
