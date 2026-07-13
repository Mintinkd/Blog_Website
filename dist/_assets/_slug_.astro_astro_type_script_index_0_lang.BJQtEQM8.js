import{t as n,getLocale as $}from"./i18n.CQj9Tpoy.js";function y(a){return String(a??"").replace(/[&<>"]/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[e])}async function o(a=1){const e=document.querySelector(".article-list-inner");if(!e)return;const r=document.getElementById("article-list");if(!r)return;const p=r.dataset.tagSlug,g=$()==="zh"?"zh-CN":"en-US";try{const c=await(await fetch(`/api/v1/articles?page=${a}&status=published&tag_slug=${p}`)).json();if(c.code===0&&c.data){const{items:d,total_pages:l}=c.data;if(d.length===0){e.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${n("page.no_articles_tag")}</p>`;return}e.innerHTML=d.map(t=>`
          <article class="list-card">
            <a href="/articles/${t.slug}" class="list-card-link">
              <div class="list-card-body">
                <div class="list-card-meta">
                  ${t.category?`<span class="list-card-category">${t.category.name}</span>`:""}
                  <span class="list-card-date">${t.published_at?new Date(t.published_at).toLocaleDateString(g,{year:"numeric",month:"long",day:"numeric"}):""}</span>
                </div>
                <h3 class="list-card-title">${t.title}</h3>
                ${t.summary?`<p class="list-card-summary">${t.summary}</p>`:""}
                <div class="list-card-footer">
                  <div class="list-card-tags">
                    ${(t.tags||[]).slice(0,3).map(s=>`<a href="/tags/${s.slug}" class="list-card-tag">${y(s.name)}</a>`).join("")}
                  </div>
                  <span class="list-card-stats">${t.view_count||0} ${n("article.read")}</span>
                </div>
              </div>
            </a>
          </article>
        `).join("");const i=document.getElementById("pagination-mount");if(i&&l>1){let t='<div class="pagination">';a>1&&(t+=`<button class="pag-btn" data-page="${a-1}">${n("page.prev")}</button>`),t+=`<span class="pag-info">${a} / ${l}</span>`,a<l&&(t+=`<button class="pag-btn" data-page="${a+1}">${n("page.next")}</button>`),t+="</div>",i.innerHTML=t,i.querySelectorAll(".pag-btn").forEach(s=>{s.addEventListener("click",()=>{const m=parseInt(s.dataset.page||"1",10);o(m),window.scrollTo({top:0,behavior:"smooth"})})})}}}catch{e.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${n("common.load_failed")}</p>`}}o();document.addEventListener("locale-changed",()=>o());
