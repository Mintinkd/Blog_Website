import{t as s}from"./i18n.Bppg9S7s.js";async function o(){const a=document.getElementById("tags-cloud");if(a)try{const t=await(await fetch("/api/v1/tags")).json();if(t.code===0&&t.data){const n=Array.isArray(t.data)?t.data:t.data.items||[];if(n.length===0){a.innerHTML=`<p class="tags-empty">${s("page.no_articles_tag")}</p>`;return}n.sort((e,r)=>(r.article_count||0)-(e.article_count||0)),a.innerHTML=n.map(e=>`
          <a href="/tags/${e.slug}" class="tag-item">
            <span>${e.name}</span>
            <span class="tag-count">${e.article_count||0}</span>
          </a>
        `).join("")}else a.innerHTML=`<p class="tags-empty">${s("common.load_failed")}</p>`}catch{a.innerHTML=`<p class="tags-empty">${s("common.load_failed")}</p>`}}document.addEventListener("astro:page-load",()=>o());document.addEventListener("locale-changed",()=>o());
