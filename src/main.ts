import { createApp } from 'vue'
import App from './App.vue'
import router from './router';

import { IonicVue } from '@ionic/vue';
import { addIcons } from 'ionicons';
import {
  receiptOutline,
  checkmarkCircle,
  peopleOutline,
  cashOutline,
  calendarOutline,
  statsChartOutline,
  addOutline,
  alertCircle,
  printOutline,
  documentTextOutline,
  closeOutline,
  cloudDownloadOutline,
  cloudUploadOutline,
  arrowBackOutline,
  searchOutline,
  filterOutline,
  walletOutline,
  ellipsisVertical,
  eyeOutline,
  pencilOutline,
  banOutline,
  trashOutline,
  personAddOutline,
  schoolOutline,
  idCardOutline,
  chevronDownOutline,
  checkmarkOutline,
  chevronForwardOutline,
} from 'ionicons/icons';

addIcons({
  'receipt-outline': receiptOutline,
  receiptOutline,
  'checkmark-circle': checkmarkCircle,
  checkmarkCircle,
  'people-outline': peopleOutline,
  peopleOutline,
  'cash-outline': cashOutline,
  cashOutline,
  'calendar-outline': calendarOutline,
  calendarOutline,
  'stats-chart-outline': statsChartOutline,
  statsChartOutline,
  'add-outline': addOutline,
  addOutline,
  'alert-circle': alertCircle,
  alertCircle,
  'print-outline': printOutline,
  printOutline,
  'document-text-outline': documentTextOutline,
  documentTextOutline,
  'close-outline': closeOutline,
  closeOutline,
  'cloud-download-outline': cloudDownloadOutline,
  cloudDownloadOutline,
  'cloud-upload-outline': cloudUploadOutline,
  cloudUploadOutline,
  'arrow-back-outline': arrowBackOutline,
  arrowBackOutline,
  'search-outline': searchOutline,
  searchOutline,
  'filter-outline': filterOutline,
  filterOutline,
  'wallet-outline': walletOutline,
  walletOutline,
  'ellipsis-vertical': ellipsisVertical,
  ellipsisVertical,
  'eye-outline': eyeOutline,
  eyeOutline,
  'pencil-outline': pencilOutline,
  pencilOutline,
  'ban-outline': banOutline,
  banOutline,
  'trash-outline': trashOutline,
  trashOutline,
  'person-add-outline': personAddOutline,
  personAddOutline,
  'school-outline': schoolOutline,
  schoolOutline,
  'id-card-outline': idCardOutline,
  idCardOutline,
  'chevron-down-outline': chevronDownOutline,
  chevronDownOutline,
  'checkmark-outline': checkmarkOutline,
  checkmarkOutline,
  'chevron-forward-outline': chevronForwardOutline,
  chevronForwardOutline,
});

/* Core CSS required for Ionic components to work properly */
import '@ionic/vue/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/vue/css/padding.css';
import '@ionic/vue/css/float-elements.css';
import '@ionic/vue/css/text-alignment.css';
import '@ionic/vue/css/text-transformation.css';
import '@ionic/vue/css/flex-utils.css';
import '@ionic/vue/css/display.css';

/**
 * Ionic Dark Mode
 * -----------------------------------------------------
 * For more info, please see:
 * https://ionicframework.com/docs/theming/dark-mode
 */

/* @import '@ionic/vue/css/palettes/dark.always.css'; */
import '@ionic/vue/css/palettes/dark.class.css';
/* import '@ionic/vue/css/palettes/dark.system.css'; */

/* Theme variables & custom design tokens */
import './theme/tokens.css';
import './theme/variables.css';
import './theme/custom.css';
import './theme/premium-aurora.css';
import './theme/premium-motion.css';
import './theme/premium-interactions.css';

const app = createApp(App)
  .use(IonicVue)
  .use(router);

router.isReady().then(() => {
  app.mount('#app');
});
