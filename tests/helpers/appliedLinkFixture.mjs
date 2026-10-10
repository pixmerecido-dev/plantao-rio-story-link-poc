// Modelos de respostas Appium para testar sinais positivos e negativos; não são IDs novos.
export const description = 'Sticker. Touch and hold to reposition. Use two fingers to rotate or resize. https://plantaorio.com.br/';
export const bounds = '[202,901][877,1017]';
export const positiveCanvasXML = `<node resource-id="asset_button" displayed="true"/><node resource-id="com.instagram.android:id/capture_interactive_drawable_container" bounds="[0,0][1080,1920]" displayed="true"><node content-desc="${description}" text="" bounds="${bounds}" displayed="true"/></node>`;
export function appliedElement() {
  return { isExisting: async () => true, isDisplayed: async () => true, getText: async () => '',
    getAttribute: async name => name === 'bounds' ? bounds : name === 'content-desc' ? description : '' };
}
