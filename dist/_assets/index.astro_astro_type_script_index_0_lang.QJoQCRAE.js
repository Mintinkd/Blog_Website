import{t as c}from"./i18n.CQj9Tpoy.js";function s(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}async function o(){const e=document.getElementById("categories-cloud");if(e)try{const t=await(await fetch("/api/v1/categories")).json();if(t.code===0&&t.data){const n=Array.isArray(t.data)?t.data:t.data.items||[];if(n.length===0){e.innerHTML=`<p class="categories-empty">${c("page.no_categories")}</p>`;return}n.sort((a,i)=>(i.article_count||0)-(a.article_count||0)),e.innerHTML=n.map(a=>`
          <a href="/categories/${a.slug}" class="category-item">
            <div class="category-head">
              <span class="category-name">${s(a.name)}</span>
              <span class="category-count">${a.article_count||0} ${c("admin.article_count")}</span>
            </div>
            ${a.description?`<span class="category-desc">${s(a.description)}</span>`:""}
          </a>
        `).join("")}else e.innerHTML=`<p class="categories-empty">${c("common.load_failed")}</p>`}catch{e.innerHTML=`<p class="categories-empty">${c("common.load_failed")}</p>`}}o();document.addEventListener("locale-changed",()=>o());
