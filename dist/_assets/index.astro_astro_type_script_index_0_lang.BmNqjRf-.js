import{t as n}from"./i18n.Bppg9S7s.js";import{s as p}from"./escape.DHLiVI85.js";import"./purify.es.Csrj9YNg.js";function c(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}async function o(){const e=document.getElementById("categories-cloud");if(e)try{const t=await(await fetch("/api/v1/categories")).json();if(t.code===0&&t.data){const s=Array.isArray(t.data)?t.data:t.data.items||[];if(s.length===0){e.innerHTML=`<p class="categories-empty">${n("page.no_categories")}</p>`;return}s.sort((a,i)=>(i.article_count||0)-(a.article_count||0)),e.innerHTML=s.map(a=>`
          <a href="/categories/${p(a.slug)}" class="category-item">
            <div class="category-head">
              <span class="category-name">${c(a.name)}</span>
              <span class="category-count">${a.article_count||0} ${n("admin.article_count")}</span>
            </div>
            ${a.description?`<span class="category-desc">${c(a.description)}</span>`:""}
          </a>
        `).join("")}else e.innerHTML=`<p class="categories-empty">${n("common.load_failed")}</p>`}catch{e.innerHTML=`<p class="categories-empty">${n("common.load_failed")}</p>`}}document.addEventListener("astro:page-load",()=>o());document.addEventListener("locale-changed",()=>o());
