import Fuse from 'fuse.js'

/**
 * Booyaka Client App
 * 
 * This module initializes the client-side application, sets up UI interactions,
 * and provides utility functions for features like sticky sidebars and "time ago" formatting.
 */
const defaultAppOpts = {
  /**
   * Enable sticky sidebars that remain visible below the navbar when scrolling.
   * This is useful for keeping navigation or other important elements accessible.
   */
  enableStickySidebar: true,

  /**
   * Enable "time ago" formatting for <time> elements with a datetime attribute.
   * This converts timestamps into a human-readable format like "5 minutes ago".
   * It enhances the user experience by providing relative time information.
  */
  enableTimeAgo: true,

  /**
   * Enable animated alerts that follow the mouse cursor within the alert box.
   * This adds a dynamic visual effect to alert messages, making them more engaging.
   * The animation allows the alert to move slightly in response to mouse movements,
   * creating an interactive experience for the user.
  */
  enableAnimatedAlerts: true
}

/**
 * Callbacks registered via `UI.onReload` that run every time a page is
 * loaded or swapped via SPA navigation.
 */
const reloadCallbacks = [];

const UI = {
  /**
   * Initialize the application with the given options.
   * This function sets up the UI features based on the provided options.
   * It also adds necessary event listeners and applies styles to checkboxes.
   * 
   * @param {Object} opts - Configuration options for initializing the app.
   * @param {boolean} opts.enableStickySidebar - Whether to enable sticky sidebars.
   * @param {boolean} opts.enableTimeAgo - Whether to enable "time ago" formatting.
   * @param {callback} opts.fetchAndSwapCallback - Optional callback to override the default fetchAndSwap behavior.
   *
  */
  init: function(opts = defaultAppOpts) {
    if (this._initialized) return this;
    this._initialized = true;
    console.log("StupidGreen Initialized. More about SG here: https://github.com/openpeeps/stupidgreen");
    opts.enableStickySidebar && this.initStickySidebar();
    opts.enableTimeAgo && this.initTimeAgo()
    opts.enableAnimatedAlerts && this.initAnimatedAlerts();
    
    this.initSmoothAnchors();
    this.initExternalLinksDecorator();
    this.initSpotlightSearch();
    this.initShareButtons();

    const fetchSwapCallback = function() {
      opts.enableStickySidebar && this.initStickySidebar();
      opts.enableTimeAgo && this.initTimeAgo();
      opts.fetchAndSwapCallback && opts.fetchAndSwapCallback(); // custom callback for additional initialization
      opts.enableAnimatedAlerts && this.initAnimatedAlerts();
    
      this.initSmoothAnchors();
      this.initExternalLinksDecorator();
      this.initShareButtons();

      if (sidebarNavigation) {
        sidebarNavigation.querySelectorAll('a').forEach(link => link.classList.remove('active', 'bg-dark'));
        // after fetching new content, we want to make the current page's link active in the sidebar
        const currentPath = location.pathname;
        const activeLink = sidebarNavigation.querySelector(`a[href="${currentPath}"]`);
        if (activeLink) {
          activeLink.classList.add('active', 'bg-dark');
        }
      }

      this.triggerReload();
    }.bind(this) // bind 'this' to ensure the correct context inside the callback

    // Intercept clicks on internal links to enable SPA-like navigation without full page reloads.
    let sidebarNavigation = document.querySelector('.sidebar-navigation')
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a &&  a.href &&  a.origin === location.origin && !a.hasAttribute('download') && 
        !a.target &&  !a.href.startsWith('mailto:') &&  !a.href.startsWith('tel:') && !a.getAttribute('href').startsWith('#')) {
        e.preventDefault();
        this.fetchAndSwap(a.pathname + a.search, true, fetchSwapCallback);
      }
    });

    // Apply Bootstrap classes to checkboxes for consistent styling
    document.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.classList.add('form-check-input'); // the bootstrap class
    });

    // Fire reload callbacks once on initial page load
    this.triggerReload();
  },

  /**
   * Register a callback that runs every time a page is loaded or swapped.
   * This is useful for lazily initializing features (e.g., lazy-loading
   * iframes) that need to be re-applied to newly fetched content.
   *
   * @param {callback} callback - Function to run on every page load/swap.
   */
  onReload: function(callback) {
    reloadCallbacks.push(callback);
  },

  /**
   * Run all registered `onReload` callbacks.
   */
  triggerReload: function() {
    reloadCallbacks.forEach(cb => {
      try { cb() } catch (e) { console.error(e) }
    });
  },

  // Initialize client-side search (Fuse.js) for every search form on the page.
  // Forms with `data-results-target` render full results inline (the /search page);
  // all other forms get a spotlight autocomplete dropdown (the header).
  initSpotlightSearch: function() {
    const forms = document.querySelectorAll('.spotlight-form');
    if (!forms.length) return;
    forms.forEach(form => this.initSearchForm(form));
  },

  initSearchForm: function(form) {
    const input = form.querySelector('.spotlight');
    if (!input) return;
    // Derive the site base from the form's own action so search works
    // under subpath deployments (/blog/...) in every environment.
    let siteBase = '';
    try {
      const actionPath = new URL(form.action, window.location.href).pathname;
      siteBase = actionPath.replace(/\/search\/?$/, '');
    } catch (e) { /* keep site base empty */ }
    const resultsUrl = form.dataset.resultsUrl || (siteBase + '/results.json');
    const resolveUrl = (url) => siteBase + '/' + String(url || '').replace(/^\//, '');
    fetch(resultsUrl)
      .then(response => {
        if (!response.ok) throw new Error('Search index not found');
        return response.json();
      })
      .then(data => {
        if (!data || !data.results) return;
        const fuse = new Fuse(data.results, {
          keys: ['title', 'description', 'headings'],
          minMatchCharLength: 2,
          includeMatches: true,
          threshold: 0.35,
          ignoreLocation: true,
          findAllMatches: false,
        });
        const pageLang = document.documentElement.dataset.lang || '';
        const runQuery = (query) => fuse.search(query).filter(r =>
          !pageLang || (r.item.lang || '') === pageLang);
        const targetSelector = form.dataset.resultsTarget;
        const target = targetSelector ? document.querySelector(targetSelector) : null;
        if (target) {
          this.initInlineResults(form, input, target, runQuery, resolveUrl);
        } else {
          this.initAutocomplete(form, input, runQuery, resolveUrl);
        }
      })
      .catch(() => { /* search index unavailable; forms fall back to plain GET */ });
  },

  // Full results list for the dedicated /search page (pure CSR).
  initInlineResults: function(form, input, target, runQuery, resolveUrl) {
    const renderResults = (query) => {
      const results = runQuery(query);
      target.innerHTML = '';
      if (!results.length) {
        target.innerHTML = '<p class="text-muted">No results found.</p>';
        return;
      }
      for (const r of results) {
        const a = document.createElement('a');
        a.href = resolveUrl(r.item.url);
        a.className = 'd-block text-decoration-none mb-3';
        const title = document.createElement('span');
        title.className = 'd-block fw-bold';
        title.textContent = r.item.title;
        a.appendChild(title);
        if (r.item.description) {
          const desc = document.createElement('span');
          desc.className = 'text-muted small d-block';
          desc.textContent = r.item.description;
          a.appendChild(desc);
        }
        target.appendChild(a);
      }
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const query = input.value.trim();
      if (query.length < 2) return;
      renderResults(query);
    });
    input.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (query.length < 2) {
        target.innerHTML = '<p class="text-muted">No results yet.</p>';
        return;
      }
      renderResults(query);
    });
    // Run the query from ?q= on direct loads (plain GET fallback submits here)
    try {
      const initial = (new URLSearchParams(window.location.search).get('q') || '').trim();
      if (initial.length >= 2) {
        input.value = initial;
        renderResults(initial);
      }
    } catch (e) { /* URLSearchParams unavailable */ }
  },

  // Spotlight autocomplete dropdown for the header search form.
  initAutocomplete: function(form, input, runQuery, resolveUrl) {
    const spotlightAutocomplete = document.createElement('div');
    spotlightAutocomplete.classList.add('position-fixed', 'border', 'border-dark', 'list-unstyled', 'w-100', 'rounded-4', 'p-2', 'd-none', 'spotlight-autocomplete');
    spotlightAutocomplete.style.top = '68px';
    spotlightAutocomplete.style.zIndex = '1050';
    spotlightAutocomplete.style.maxWidth = form.offsetWidth + 'px';
    spotlightAutocomplete.style.left = form.getBoundingClientRect().left + 'px';
    spotlightAutocomplete.style.backgroundColor = 'rgba(10,14,14,0.60)';
    spotlightAutocomplete.style.boxShadow = '0 30px 30px rgba(0,0,0,.8)';
    spotlightAutocomplete.style.backdropFilter = 'blur(34px)';
    spotlightAutocomplete.style.maxHeight = '280px';

    const spotlightInner = document.createElement('ul');
    spotlightInner.classList.add('m-0', 'p-0', 'spotlight-autocomplete-list');
    spotlightInner.style.overflowX = 'scroll';
    spotlightInner.style.maxHeight = '260px';

    spotlightAutocomplete.appendChild(spotlightInner);
    document.body.insertAdjacentElement('beforeend', spotlightAutocomplete);

    // clicking outside the autocomplete closes it
    document.addEventListener('click', function(event) {
      if (!form.contains(event.target)) {
        spotlightAutocomplete.classList.add('d-none');
      }
    });

    // pressing cmd/ctrl + / focuses the search input
    var isSpotlightFocused = false;
    input.addEventListener('click', function() {
      isSpotlightFocused = true;
    });

    document.addEventListener('keydown', function(event) {
      if (event.key === '/' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        input.focus();
        isSpotlightFocused = true;
      }
      // handle arrow keys and enter for navigating the autocomplete list
      if (isSpotlightFocused) {
        const items = spotlightAutocomplete.querySelectorAll('.spotlight-autocomplete-item');
        var index = Array.from(items).findIndex(item => item.classList.contains('active'));
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (index < items.length - 1) {
            if (index >= 0) items[index].classList.remove('active');
            items[++index].classList.add('active');
            items[index].scrollIntoView({ block: 'nearest' });
          }
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (index > 0) {
            items[index].classList.remove('active');
            items[--index].classList.add('active');
            items[index].scrollIntoView({ block: 'nearest' });
          }
        } else if (event.key === 'Enter') {
          if (index >= 0) {
            event.preventDefault();
            // before navigating, we want to collect the page title
            // and fill the search input with it, so that when user goes back,
            // they see the title of the page they visited instead of the search query
            const title = items[index].querySelector('span.d-block').textContent;
            input.value = title;
            // navigate to the selected page
            items[index].click();
          }
          // otherwise fall through to the native submit -> /search?q= (CSR page)
        }
      }
    });

    function searchDocs(query) {
      const results = runQuery(query);
      // results is an array of objects: { item, refIndex, ... }
      spotlightInner.innerHTML = '';
      if (results.length === 0) {
        spotlightAutocomplete.classList.add('d-none');
        return;
      }
      spotlightAutocomplete.classList.remove('d-none');
      for (const r of results) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.classList.add('d-block', 'rounded-4', 'py-2', 'px-3', 'border-0', 'text-decoration-none', 'spotlight-autocomplete-item');
        a.href = resolveUrl(r.item.url);
        a.innerHTML = `<span class="d-block">${r.item.title}</span><span class="text-muted small d-block lh-sm">${r.item.description}</span>`;
        li.appendChild(a);

        // use provided indices to highlight matched terms
        for (const match of r.matches) {
          if (match.key === 'title' || match.key === 'description') {
            // Find the corresponding span for title/description
            const spanSelector = match.key === 'title' ? 'span.d-block' : 'span.text-muted';
            const span = a.querySelector(spanSelector);
            if (span) {
              const text = span.textContent;
              let highlighted = '';
              let lastIndex = 0;
              for (const range of match.indices) {
                const start = range[0];
                const end = range[1] + 1;
                highlighted += text.slice(lastIndex, start);
                highlighted += '<mark>' + text.slice(start, end) + '</mark>';
                lastIndex = end;
              }
              highlighted += text.slice(lastIndex);
              span.innerHTML = highlighted;
            }
          }
        }
        spotlightInner.appendChild(li);
      }
    }

    input.addEventListener('keydown', function(event) {
      if (event.key === '/' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        input.focus();
      } else if (event.key === 'Escape') {
        spotlightAutocomplete.classList.add('d-none');
      }
    });

    input.addEventListener('input', function(event) {
      const query = event.target.value;
      if (query.length < 2) {
        spotlightAutocomplete.classList.add('d-none');
        return;
      }
      searchDocs(query);
    });
  },

  /**
   * Make sidebars sticky so they remain visible when scrolling down the page.
   */
  initStickySidebar: function() {
    const sidebars = document.querySelectorAll('.sticky-sidebar');
    const navbarHeight = document.querySelector('.navbar-container-area').offsetHeight;
    const extraPadding = 30; // px, adjust for pt-5 effect
    function updateSidebarTop() {
      for (const sidebar of sidebars) {
        sidebar.style.top = (navbarHeight + extraPadding) + 'px';
      }
    }
    window.addEventListener('scroll', updateSidebarTop);
    window.addEventListener('resize', updateSidebarTop);
    updateSidebarTop()
  },

  /**
   * Initialize smooth scrolling for internal anchor links.
   * This function ensures that when users click on links that point to anchors within the page,
   * the page will scroll smoothly to the target section, accounting for the height of the sticky navbar.
   */
  initSmoothAnchors: function() {
    // Smooth scroll to anchor, offset by sticky navbar height
    function scrollToAnchorWithOffset(hash) {
      const navbar = document.querySelector('.navbar-container-area');
      const navbarHeight = navbar ? navbar.offsetHeight : 0;
      const target = document.getElementById(hash);
      if (target) {
        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset;
        window.scrollTo({
          top: targetPosition - navbarHeight,
          behavior: 'smooth'
        });
      }
    }

    // Attach click event to all internal anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        const rawHash = this.getAttribute('href');
        const hash = decodeURIComponent(rawHash.slice(1));
        if (hash) {
          const target = document.getElementById(hash) || document.querySelector(`[name="${hash}"]`);
          if (target) {
            e.preventDefault();
            scrollToAnchorWithOffset(hash);
            history.replaceState(null, null, rawHash);
          }
        }
      });
    });

    // If page loads with a hash, scroll to it with offset
    if (window.location.hash) {
      setTimeout(() => {
        const hash = window.location.hash.slice(1);
        scrollToAnchorWithOffset(hash);
      }, 100);
    }
  },


  /**
   * Fetches the given URL and swaps the content of the current
   * view with the new view from the response.
   * 
   * If the fetch fails or the expected view container is not
   * found in the response, it falls back to a full page reload.
   * 
   * @param {string} url - The URL to fetch and swap.
   * @param {boolean} pushState - Whether to push the new URL to the browser history (default: true).
   * @param {callback} callback - Optional callback to execute after successful content swap.
   * @returns {void}
  */
  fetchAndSwap(url, pushState = true, callback) {
    fetch(url, {headers: {'X-Requested-With': 'spa'}})
      .then(resp => {
        if (!resp.ok) throw new Error('Network error');
        return resp.text();
      })
      .then(html => {
        // parse the returned HTML and extract the new view
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const newView = doc.querySelector('[data-view]');
        const currentView = document.querySelector('[data-view]');
        const newToc = doc.querySelector('[data-view-right]');
        const currentToc = document.querySelector('[data-view-right]');
        let swapped = false;
        if (newView && currentView) {
          currentView.innerHTML = newView.innerHTML;
          swapped = true;
        }
        if (newToc && currentToc) {
          currentToc.innerHTML = newToc.innerHTML;
          swapped = true;
        }
        if (swapped) {
          if (pushState) history.pushState(null, '', url);
          window.scrollTo(0, 0);
          callback && callback(url, newView, newToc);
        } else {
          console.warn('Could not find view containers in the fetched HTML. Reloading the page as fallback.');
          location.href = url;
        }
      }).catch(() => location.href = url);
  },

  initShareButtons: function() {
    const flashCopied = (btn) => {
      const label = btn.querySelector('.share-label');
      if (!label) return;
      if (!label.dataset.original) label.dataset.original = label.textContent;
      label.textContent = 'Copied!';
      btn.classList.add('is-copied');
      setTimeout(() => {
        label.textContent = label.dataset.original;
        btn.classList.remove('is-copied');
      }, 1500);
    };
    const fallbackCopy = (text, btn) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* clipboard unavailable */ }
      document.body.removeChild(ta);
      flashCopied(btn);
    };
    const copyText = (text, btn) => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => flashCopied(btn)).catch(() => fallbackCopy(text, btn));
      } else {
        fallbackCopy(text, btn);
      }
    };
    document.querySelectorAll('[data-share-url]').forEach(btn => {
      if (btn.dataset.shareBound) return;
      btn.dataset.shareBound = '1';
      btn.addEventListener('click', () => copyText(window.location.href, btn));
    });
    document.querySelectorAll('[data-share-md]').forEach(btn => {
      if (btn.dataset.shareBound) return;
      btn.dataset.shareBound = '1';
      btn.addEventListener('click', () => {
        const el = document.querySelector('#share-markdown-content');
        if (!el) return;
        try {
          copyText(JSON.parse(el.textContent).markdown, btn);
        } catch (e) { /* invalid markdown payload */ }
      });
    });
  },

  initExternalLinksDecorator: function() {
    // Function to check if a link is external
    function isExternalLink(anchor) {
      return anchor.hostname && anchor.hostname !== window.location.hostname;
    }

    // Example: Add 'external' class to all external links
    document.querySelectorAll('a[href]').forEach(a => {
      if (isExternalLink(a)) {
        a.classList.add('external');
        a.setAttribute('target', '_blank');
      }
    });
  },

  /**
   * Initialize the application with the default options.
   */
  initAnimatedAlerts: function() {
    document.querySelectorAll('.alert').forEach(alert => {
      const anim = document.createElement('div');
      anim.className = 'alert-animation';
      anim.style.left = '0px';
      anim.style.top = '0px';
      alert.style.position = 'relative';
      alert.insertAdjacentElement('afterbegin', anim);

      const offsetX = 400;
      const offsetY = 400;

      document.body.addEventListener('mousemove', e => {
        const rect = alert.getBoundingClientRect();
        const animW = anim.offsetWidth;
        const animH = anim.offsetHeight;
        let x = e.clientX - rect.left - animW / 2;
        let y = e.clientY - rect.top - animH / 2;

        // Allow exceeding by offset
        x = Math.max(-offsetX, Math.min(x, rect.width - animW + offsetX));
        y = Math.max(-offsetY, Math.min(y, rect.height - animH + offsetY));

        // Calculate rotation based on mouse position (example: angle from center)
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const dx = x + animW / 2 - centerX;
        const dy = y + animH / 2 - centerY;
        const angle = Math.atan2(dy, dx) * (18 / Math.PI); // degrees
        anim.style.transform = 'translate(' + x + 'px, ' + y + 'px) rotate(' + angle + 'deg)';
      });
    });
  },
  
  /**
   * Initialize "time ago" formatting for <time> elements.
   *
   * Uses the browser's built-in internationalization
   * (`Intl.RelativeTimeFormat`), so the phrasing follows the visitor's
   * locale automatically — no hardcoded English strings.
   * Example: "2023-10-01 12:00:00" -> "5 minutes ago" (or the locale equivalent)
   */
  initTimeAgo: function() {
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    function timeago(dateString) {
      const date = new Date(dateString.replace(' ', 'T'));
      const diffSec = Math.round((date - new Date()) / 1000);
      const abs = Math.abs(diffSec);
      if (abs < 60) return rtf.format(diffSec, "second");
      if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
      if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
      if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), "day");
      if (abs < 31536000) return rtf.format(Math.round(diffSec / 2592000), "month");
      return rtf.format(Math.round(diffSec / 31536000), "year");
    }
    document.querySelectorAll('time[datetime]').forEach(span => {
      span.textContent = timeago(span.getAttribute('datetime'));
    });
  }
}

export default UI;

// Expose globally for classic inline scripts (e.g. `UI.onReload(...)`),
// which cannot see module scope.
window.UI = UI;

// Self-initialize on page load. This is the single init entry point.
document.addEventListener('DOMContentLoaded', () => {
  UI.init({
    enableStickySidebar: true,
    enableTimeAgo: true,
    enableAnimatedAlerts: true
  });
});
