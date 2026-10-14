import{t as n}from"./i18n.Bppg9S7s.js";function s(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}async function o(){const e=document.getElementById("categories-cloud");if(e)try{const t=await(await fetch("/api/v1/categories")).json();if(t.code===0&&t.data){const c=Array.isArray(t.data)?t.data:t.data.items||[];if(c.length===0){e.innerHTML=`<p class="categories-empty">${n("page.no_categories")}</p>`;return}c.sort((a,i)=>(i.article_count||0)-(a.article_count||0)),e.innerHTML=c.map(a=>`
          <a href="/categories/${a.slug}" class="category-item">
            <div class="category-head">
              <span class="category-name">${s(a.name)}</span>
              <span class="category-count">${a.article_count||0} ${n("admin.article_count")}</span>
            </div>
            ${a.description?`<span class="category-desc">${s(a.description)}</span>`:""}
          </a>
        `).join("")}else e.innerHTML=`<p class="categories-empty">${n("common.load_failed")}</p>`}catch{e.innerHTML=`<p class="categories-empty">${n("common.load_failed")}</p>`}}document.addEventListener("astro:page-load",()=>o());document.addEventListener("locale-changed",()=>o());
