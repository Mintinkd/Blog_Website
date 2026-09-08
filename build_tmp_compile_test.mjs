import { compileTemplate } from '@vue/compiler-sfc';
const src = '<input type="checkbox" v-model="form.is_active" />';
const r = compileTemplate({ id: 'test', filename: 'test.vue', source: src, compilerOptions: { mode: 'module' } });
console.log('=== CHECKBOX ===');
console.log(r.code.slice(0, 1800));
