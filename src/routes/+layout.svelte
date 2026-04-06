<script>
  import { page } from '$app/stores';
  import { base } from '$app/paths';
</script>

<nav>
  <a href="{base}/map" class:selected={$page.url.pathname === `${base}/map`}>Map</a>
  <a href="{base}/weather" class:selected={$page.url.pathname === `${base}/weather`}>Weather</a>
</nav>

<slot />

<style>
  nav {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;

    /* 地図より前に出す */
    position: relative;
    z-index: 2000;
  }

  a {
    padding: 8px 16px;
    border-radius: 6px;
    background: #eee;
    text-decoration: none;
    color: #333;
  }

  a.selected {
    background: #ff6f61;
    color: white;
  }
</style>