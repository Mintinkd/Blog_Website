import{t as s}from"./i18n.CQj9Tpoy.js";async function c(){const a=document.getElementById("tags-cloud");if(a)try{const t=await(await fetch("/api/v1/tags")).json();if(t.code===0&&t.data){const e=Array.isArray(t.data)?t.data:t.data.items||[];if(e.length===0){a.innerHTML=`<p class="tags-empty">${s("page.no_articles_tag")}</p>`;return}e.sort((n,r)=>(r.article_count||0)-(n.article_count||0)),a.innerHTML=e.map(n=>`
          <a href="/tags/${n.slug}" class="tag-item">
            <span>${n.name}</span>
            <span class="tag-count">${n.article_count||0}</span>
          </a>
        `).join("")}else a.innerHTML=`<p class="tags-empty">${s("common.load_failed")}</p>`}catch{a.innerHTML=`<p class="tags-empty">${s("common.load_failed")}</p>`}}c();document.addEventListener("locale-changed",()=>c());
