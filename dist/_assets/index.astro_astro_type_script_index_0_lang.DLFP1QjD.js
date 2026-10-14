import{t as o,g as y}from"./i18n.Bppg9S7s.js";import{g as u,c as $,a as h,b as f}from"./categoryColors.B-OBBTpf.js";import{b as L,e as s,s as _}from"./escape.DHLiVI85.js";import"./purify.es.Csrj9YNg.js";async function d(){const t=document.getElementById("article-grid");if(!t)return;const i=y()==="zh"?"zh-CN":"en-US";try{const r=await(await fetch("/api/v1/articles?page=1&page_size=6&status=published")).json();if(r.code===0&&r.data){const{items:c}=r.data;if(c.length===0){t.innerHTML=`<p class="empty-text" style="grid-column:1/-1;text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${o("article.no_articles")}</p>`;return}const g=L;t.innerHTML=c.map(a=>{const e=a.category,n=u(e?.slug,e?.name),p=e?$(n):"",m=a.cover_image?`<div class="card-cover"><img src="${g(a.cover_image)}" alt="" loading="lazy" /></div>`:`<div class="card-cover card-cover-grad" style="${h(n)}"><span class="cover-cat-name" style="${f(n)}">${s(e?.name||"✦")}</span></div>`;return`
          <article class="article-card" data-reveal="fade-up">
            <a href="/articles/${_(a.slug)}" class="card-link">
              ${m}
              <div class="card-body">
                <div class="card-meta">
                  ${e?`<span class="card-category" style="${p}">${s(e.name)}</span>`:""}
                  <span class="card-date">${a.published_at?new Date(a.published_at).toLocaleDateString(i,{year:"numeric",month:"long",day:"numeric"}):""}</span>
                </div>
                <h3 class="card-title">${s(a.title)}</h3>
                <p class="card-summary">${s(a.summary||"")}</p>
                <div class="card-footer">
                  <div class="card-tags">
                    ${(a.tags||[]).slice(0,2).map(v=>`<span class="card-tag">${s(v.name)}</span>`).join("")}
                  </div>
                  <span class="card-read">${a.view_count||0} ${o("article.read")}</span>
                </div>
              </div>
            </a>
          </article>`}).join(""),t.classList.toggle("grid-single",c.length===1),window.dispatchEvent(new CustomEvent("motion:refresh"))}}catch{t.innerHTML=`<p class="error-text" style="grid-column:1/-1;text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${o("article.load_error")}</p>`}}document.addEventListener("astro:page-load",()=>d());document.addEventListener("locale-changed",()=>d());
