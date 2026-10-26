Component({
  properties: { word: { type: Object, value: {} } },
  methods: { open() { this.triggerEvent('openword', { id: this.data.word.id }); } }
});
