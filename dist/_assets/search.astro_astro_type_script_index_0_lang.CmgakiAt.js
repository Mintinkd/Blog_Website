import{t as o}from"./i18n.CQj9Tpoy.js";function s(a){return String(a).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}async function i(){const a=document.getElementById("search-tags");if(a)try{const e=await(await fetch("/api/v1/tags")).json();if(e.code===0&&e.data){const n=Array.isArray(e.data)?e.data:e.data.items||[];if(n.length===0){a.innerHTML=`<p class="taxonomy-empty">${o("page.no_articles_tag")}</p>`;return}n.sort((t,r)=>(r.article_count||0)-(t.article_count||0)),a.innerHTML=n.map(t=>`
          <a href="/tags/${t.slug}" class="taxonomy-item"
             data-type="tag" data-slug="${s(t.slug)}" data-name="${s(t.name)}">
            <span>${s(t.name)}</span>
            <span class="taxonomy-count">${t.article_count||0}</span>
          </a>
        `).join("")}else a.innerHTML=`<p class="taxonomy-empty">${o("common.load_failed")}</p>`}catch{a.innerHTML=`<p class="taxonomy-empty">${o("common.load_failed")}</p>`}}async function l(){const a=document.getElementById("search-categories");if(a)try{const e=await(await fetch("/api/v1/categories")).json();if(e.code===0&&e.data){const n=Array.isArray(e.data)?e.data:e.data.items||[];if(n.length===0){a.innerHTML=`<p class="taxonomy-empty">${o("page.no_categories")}</p>`;return}n.sort((t,r)=>(r.article_count||0)-(t.article_count||0)),a.innerHTML=n.map(t=>`
          <a href="/categories/${t.slug}" class="taxonomy-item"
             data-type="category" data-slug="${s(t.slug)}" data-name="${s(t.name)}">
            <span>${s(t.name)}</span>
            <span class="taxonomy-count">${t.article_count||0}</span>
          </a>
        `).join("")}else a.innerHTML=`<p class="taxonomy-empty">${o("common.load_failed")}</p>`}catch{a.innerHTML=`<p class="taxonomy-empty">${o("common.load_failed")}</p>`}}function m(a){const e=a.target.closest(".taxonomy-item");e&&(a.preventDefault(),window.dispatchEvent(new CustomEvent("taxonomy-filter",{detail:{type:e.dataset.type,slug:e.dataset.slug,name:e.dataset.name}})),document.querySelector(".search-container")?.scrollIntoView({behavior:"smooth",block:"start"}))}document.getElementById("search-tags")?.addEventListener("click",m);document.getElementById("search-categories")?.addEventListener("click",m);i();l();document.addEventListener("locale-changed",()=>{i(),l()});
