import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectFacebookStorySharingPrompt, hasUnknownPublicationDialog } from '../dist/instagram/facebookStorySharingPrompt.js';
import { detectInstagramState } from '../dist/instagram/instagramStateMachine.js';
const source = '<hierarchy><node class="android.app.Dialog"><node text="Share your stories to Facebook too"/><node text="Always share stories" class="android.widget.Button"/><node text="Not now" class="android.widget.Button"/></node></hierarchy>';
test('título e controles exatos identificam prompt antes do editor atrás', async () => {
  assert.equal(inspectFacebookStorySharingPrompt(source).selector, 'android=new UiSelector().text("Always share stories")');
  assert.equal(await detectInstagramState({ getPageSource: async () => source, $: async () => { throw new Error('não fazer probe do editor atrás'); } }), 'STATE_FACEBOOK_STORY_SHARING_PROMPT');
});
test('prompt incompleto, oculto, duplicado ou labels fora do diálogo não autorizam continuação', () => {
  for (const xml of [source.replace('Facebook too', 'Facebook'), source.replace('Not now', 'Cancel'), source.replace('class="android.app.Dialog"', 'class="android.app.Dialog" displayed="false"'), source.replace('</node></hierarchy>', '<node text="Always share stories"/></node></hierarchy>'), '<hierarchy><node text="Share your stories to Facebook too"/><node class="android.app.Dialog"><node text="Always share stories"/><node text="Not now"/></node></hierarchy>']) assert.equal(inspectFacebookStorySharingPrompt(xml), undefined);
});
test('resource-id observado tem prioridade sem inventar ids', () => {
  assert.equal(inspectFacebookStorySharingPrompt(source.replace('text="Always share stories"', 'text="Always share stories" resource-id="fixture:id/observed"')).selector, 'android=new UiSelector().resourceId("fixture:id/observed")');
});

test('diálogo desconhecido visível bloqueia confirmação, oculto não conta', () => {
  assert.equal(hasUnknownPublicationDialog(source), false);
  assert.equal(hasUnknownPublicationDialog('<hierarchy><node class="android.app.Dialog"><node text="Unknown"/></node></hierarchy>'), true);
  assert.equal(hasUnknownPublicationDialog('<hierarchy><node class="android.app.Dialog" displayed="false"><node text="Unknown"/></node></hierarchy>'), false);
});
