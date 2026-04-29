(function () {
    var theme = localStorage.getItem('app_theme');
    if (theme && theme !== 'dark') {
        document.documentElement.setAttribute('data-theme', theme);
    }
})();
