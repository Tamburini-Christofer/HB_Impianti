// pdfmake CDN loader
(function() {
  if (!window.pdfMake) {
    var script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js';
    script.onload = function() {
      var vfs = document.createElement('script');
      vfs.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.js';
      document.head.appendChild(vfs);
    };
    document.head.appendChild(script);
  }
})();
