// Impressão (spec §10) — mesma técnica de src/lib/barcode/barcodeExport.ts
// (`injectBarcodePrintStyle`/`printBarcodeArea`): injeta CSS `@media print`
// escondendo o resto da página e mostra só a área de impressão montada na
// hora, sem abrir nova janela.

function injectPrintStyle() {
  document.getElementById('_palletcalc_print_style')?.remove();
  const el = document.createElement('style');
  el.id = '_palletcalc_print_style';
  el.textContent = `
    @media print {
      @page { size: A4; margin: 12mm; }
      body > * { display: none !important; }
      #_palletcalc_print_area { display: block !important; }
    }
    #_palletcalc_print_area { display: none; }
  `;
  document.head.appendChild(el);
}

function removePrintArtifacts() {
  document.getElementById('_palletcalc_print_style')?.remove();
  document.getElementById('_palletcalc_print_area')?.remove();
}

/** `buildArea` recebe o container já anexado ao `<body>` — normalmente um
 *  clone do painel de resultados visível, pra impressão refletir exatamente
 *  o que está na tela. */
export function printPalletReport(buildArea: (area: HTMLElement) => void): void {
  removePrintArtifacts();
  injectPrintStyle();
  const area = document.createElement('div');
  area.id = '_palletcalc_print_area';
  document.body.appendChild(area);
  buildArea(area);

  setTimeout(() => {
    window.print();
    window.addEventListener('afterprint', removePrintArtifacts, { once: true });
  }, 200);
}
