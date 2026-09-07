import{t as c,g as v}from"./i18n.Bppg9S7s.js";import{g as y,c as u,a as $,b as h}from"./categoryColors.B-OBBTpf.js";async function o(){const t=document.getElementById("article-grid");if(!t)return;const l=v()==="zh"?"zh-CN":"en-US";try{const s=await(await fetch("/api/v1/articles?page=1&page_size=6&status=published")).json();if(s.code===0&&s.data){const{items:n}=s.data;if(n.length===0){t.innerHTML=`<p class="empty-text" style="grid-column:1/-1;text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${c("article.no_articles")}</p>`;return}const i=a=>String(a||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");t.innerHTML=n.map(a=>{const e=a.category,r=y(e?.slug,e?.name),g=e?u(r):"",p=a.cover_image?`<div class="card-cover"><img src="${i(a.cover_image)}" alt="" loading="lazy" /></div>`:`<div class="card-cover card-cover-grad" style="${$(r)}"><span class="cover-cat-name" style="${h(r)}">${e?.name||"✦"}</span></div>`;return`
          <article class="article-card" data-reveal="fade-up">
            <a href="/articles/${a.slug}" class="card-link">
              ${p}
              <div class="card-body">
                <div class="card-meta">
                  ${e?`<span class="card-category" style="${g}">${e.name}</span>`:""}
                  <span class="card-date">${a.published_at?new Date(a.published_at).toLocaleDateString(l,{year:"numeric",month:"long",day:"numeric"}):""}</span>
                </div>
                <h3 class="card-title">${a.title}</h3>
                <p class="card-summary">${a.summary||""}</p>
                <div class="card-footer">
                  <div class="card-tags">
                    ${(a.tags||[]).slice(0,2).map(m=>`<span class="card-tag">${m.name}</span>`).join("")}
                  </div>
                  <span class="card-read">${a.view_count||0} ${c("article.read")}</span>
                </div>
              </div>
            </a>
          </article>`}).join(""),window.dispatchEvent(new CustomEvent("motion:refresh"))}}catch{t.innerHTML=`<p class="error-text" style="grid-column:1/-1;text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${c("article.load_error")}</p>`}}o();document.addEventListener("locale-changed",()=>o());
