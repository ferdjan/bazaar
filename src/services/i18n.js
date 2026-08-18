'use strict';

// Dictionnaire FR / AR de l'interface. Les produits/catégories ont leurs
// propres champs bilingues en base (name_fr, name_ar...).
const strings = {
  // Navigation
  'nav.home': { fr: 'Accueil', ar: 'الرئيسية' },
  'nav.catalog': { fr: 'Catalogue', ar: 'المنتجات' },
  'nav.cart': { fr: 'Panier', ar: 'السلة' },
  'nav.account': { fr: 'Mon compte', ar: 'حسابي' },
  'nav.admin': { fr: 'Administration', ar: 'الإدارة' },
  'nav.login': { fr: 'Connexion', ar: 'تسجيل الدخول' },
  'nav.register': { fr: 'Inscription', ar: 'إنشاء حساب' },
  'nav.logout': { fr: 'Déconnexion', ar: 'تسجيل الخروج' },
  'brand.tagline': { fr: 'Vêtements · Chaussures · Accessoires', ar: 'ملابس · أحذية · إكسسوارات' },
  'announce.text': { fr: 'Livraison 58 wilayas · Paiement à la livraison', ar: 'التوصيل إلى 58 ولاية · الدفع عند الاستلام' },

  // Catalogue
  'cat.all': { fr: 'Toutes les catégories', ar: 'كل الفئات' },
  'cat.search': { fr: 'Rechercher un produit…', ar: 'ابحث عن منتج…' },
  'cat.search_btn': { fr: 'Rechercher', ar: 'بحث' },
  'cat.no_results': { fr: 'Aucun produit trouvé.', ar: 'لا توجد منتجات.' },
  'product.add': { fr: 'Ajouter au panier', ar: 'أضف إلى السلة' },
  'product.stock': { fr: 'En stock', ar: 'متوفر' },
  'product.out_of_stock': { fr: 'Rupture de stock', ar: 'غير متوفر' },
  'product.description': { fr: 'Description', ar: 'الوصف' },
  'product.size': { fr: 'Taille', ar: 'المقاس' },
  'product.related': { fr: 'Produits similaires', ar: 'منتجات مشابهة' },
  'product.shipping_flat': { fr: 'Livraison 600 DA', ar: 'التوصيل 600 دج' },
  'product.stock_limited': { fr: 'Stock limité', ar: 'كمية محدودة' },

  // Panier
  'cart.title': { fr: 'Mon panier', ar: 'سلتي' },
  'cart.empty': { fr: 'Votre panier est vide.', ar: 'سلتك فارغة.' },
  'cart.product': { fr: 'Produit', ar: 'المنتج' },
  'cart.price': { fr: 'Prix', ar: 'الثمن' },
  'cart.qty': { fr: 'Quantité', ar: 'الكمية' },
  'cart.total': { fr: 'Total', ar: 'المجموع' },
  'cart.remove': { fr: 'Retirer', ar: 'حذف' },
  'cart.update': { fr: 'Mettre à jour', ar: 'تحديث' },
  'cart.checkout': { fr: 'Passer la commande', ar: 'إتمام الطلب' },
  'cart.continue': { fr: 'Continuer mes achats', ar: 'مواصلة التسوق' },
  'cart.subtotal': { fr: 'Sous-total', ar: 'المجموع الفرعي' },
  'cart.shipping': { fr: 'Livraison', ar: 'التوصيل' },
  'cart.shipping_free': { fr: 'Gratuite', ar: 'مجاني' },
  'cart.total_due': { fr: 'Total à payer', ar: 'المجموع الواجب دفعه' },
  'cart.invalid': { fr: 'Contenu du panier invalide.', ar: 'محتوى السلة غير صالح.' },
  'cart.unavailable': { fr: 'Un produit n\'est plus disponible.', ar: 'أحد المنتجات لم يعد متاحاً.' },
  'cart.invalid_size': { fr: 'Taille invalide pour un produit.', ar: 'مقاس غير صالح لأحد المنتجات.' },
  'cart.insufficient_stock': { fr: 'Stock insuffisant pour un produit.', ar: 'المخزون غير كافٍ لأحد المنتجات.' },

  // Auth
  'auth.name': { fr: 'Nom complet', ar: 'الاسم الكامل' },
  'auth.email': { fr: 'Adresse e-mail', ar: 'البريد الإلكتروني' },
  'auth.password': { fr: 'Mot de passe', ar: 'كلمة المرور' },
  'auth.phone': { fr: 'Téléphone', ar: 'الهاتف' },
  'auth.register': { fr: 'Créer un compte', ar: 'إنشاء حساب' },
  'auth.login': { fr: 'Se connecter', ar: 'تسجيل الدخول' },
  'auth.login_title': { fr: 'Connexion', ar: 'تسجيل الدخول' },
  'auth.register_title': { fr: 'Inscription', ar: 'إنشاء حساب' },
  'auth.no_account': { fr: "Pas encore de compte ?", ar: 'ليس لديك حساب؟' },
  'auth.have_account': { fr: 'Déjà un compte ?', ar: 'لديك حساب؟' },
  'auth.invalid': { fr: 'E-mail ou mot de passe incorrect.', ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
  'auth.email_exists': { fr: 'Cet e-mail est déjà utilisé.', ar: 'هذا البريد الإلكتروني مستخدم بالفعل.' },
  'auth.password_short': { fr: 'Le mot de passe doit contenir au moins 6 caractères.', ar: 'كلمة المرور يجب أن تتكون من 6 أحرف على الأقل.' },
  'auth.required': { fr: 'Veuillez remplir tous les champs.', ar: 'يرجى ملء جميع الحقول.' },

  // Checkout
  'checkout.title': { fr: 'Finaliser la commande', ar: 'إتمام الطلب' },
  'checkout.info': { fr: 'Informations de livraison', ar: 'معلومات التوصيل' },
  'checkout.address': { fr: 'Adresse', ar: 'العنوان' },
  'checkout.city': { fr: 'Ville', ar: 'المدينة' },
  'checkout.payment': { fr: 'Mode de paiement', ar: 'طريقة الدفع' },
  'checkout.cod': { fr: 'Paiement à la livraison (cash)', ar: 'الدفع عند الاستلام' },
  'checkout.stripe': { fr: 'Carte bancaire (Stripe)', ar: 'بطاقة بنكية (Stripe)' },
  'checkout.paypal': { fr: 'PayPal', ar: 'باي بال' },
  'checkout.place': { fr: 'Confirmer la commande', ar: 'تأكيد الطلب' },
  'checkout.note_eur': { fr: 'Les paiements en ligne sont facturés en EUR (montant converti).', ar: 'تُدفع المدفوعات عبر الإنترنت باليورو (المبلغ محوّل).' },
  'checkout.login_first': { fr: 'Connectez-vous ou remplissez vos informations pour commander.', ar: 'سجّل الدخول أو املأ معلوماتك للطلب.' },
  'checkout.empty': { fr: 'Votre panier est vide.', ar: 'سلتك فارغة.' },
  'checkout.summary': { fr: 'Récapitulatif', ar: 'ملخص الطلب' },

  // Commande / confirmation
  'order.ref': { fr: 'Commande', ar: 'الطلب' },
  'order.placed': { fr: 'Commande confirmée !', ar: 'تم تأكيد الطلب !' },
  'order.thanks': { fr: 'Merci pour votre commande.', ar: 'شكراً لطلبك.' },
  'order.details': { fr: 'Détails de la commande', ar: 'تفاصيل الطلب' },
  'order.items': { fr: 'Articles', ar: 'المنتجات' },
  'order.status': { fr: 'Statut', ar: 'الحالة' },
  'order.total': { fr: 'Total', ar: 'المجموع' },
  'order.date': { fr: 'Date', ar: 'التاريخ' },
  'order.payment': { fr: 'Paiement', ar: 'الدفع' },
  'order.not_found': { fr: 'Commande introuvable.', ar: 'الطلب غير موجود.' },
  'order.continue_payment': { fr: 'Payer maintenant', ar: 'ادفع الآن' },
  'account.title': { fr: 'Mon compte', ar: 'حسابي' },
  'account.orders': { fr: 'Mes commandes', ar: 'طلباتي' },
  'account.no_orders': { fr: 'Aucune commande pour le moment.', ar: 'لا توجد طلبات بعد.' },

  // Statuts
  'status.en_attente': { fr: 'En attente', ar: 'قيد الانتظار' },
  'status.payee': { fr: 'Payée', ar: 'مدفوعة' },
  'status.expediee': { fr: 'Expédiée', ar: 'تم الشحن' },
  'status.livree': { fr: 'Livrée', ar: 'تم التسليم' },
  'status.annulee': { fr: 'Annulée', ar: 'ملغاة' },
  'pay.stripe': { fr: 'Carte bancaire', ar: 'بطاقة بنكية' },
  'pay.paypal': { fr: 'PayPal', ar: 'باي بال' },
  'pay.cod': { fr: 'À la livraison', ar: 'عند الاستلام' },
  'pay.pending': { fr: 'En attente', ar: 'قيد الانتظار' },
  'pay.paid': { fr: 'Payé', ar: 'مدفوع' },
  'pay.failed': { fr: 'Échoué', ar: 'فشل' },

  // Suivi de commande
  'tracking.title': { fr: 'Suivi de commande', ar: 'تتبع الطلب' },
  'tracking.step_en_attente': { fr: 'Commande passée', ar: 'تم استلام الطلب' },
  'tracking.step_payee': { fr: 'Payée', ar: 'مدفوعة' },
  'tracking.step_expediee': { fr: 'Expédiée', ar: 'تم الشحن' },
  'tracking.step_livree': { fr: 'Livrée', ar: 'تم التسليم' },
  'tracking.step_annulee': { fr: 'Annulée', ar: 'ملغاة' },
  'tracking.carrier': { fr: 'Transporteur', ar: 'الناقل' },
  'tracking.number': { fr: 'N° de suivi', ar: 'رقم التتبع' },
  'tracking.not_yet': { fr: 'Pas encore', ar: 'ليس بعد' },
  'tracking.cancelled': { fr: 'Commande annulée', ar: 'تم إلغاء الطلب' },

  // Admin
  'admin.dashboard': { fr: 'Tableau de bord', ar: 'لوحة التحكم' },
  'admin.products': { fr: 'Produits', ar: 'المنتجات' },
  'admin.categories': { fr: 'Catégories', ar: 'الفئات' },
  'admin.orders': { fr: 'Commandes', ar: 'الطلبات' },
  'admin.users': { fr: 'Clients', ar: 'العملاء' },
  'admin.revenue': { fr: 'Chiffre d\'affaires', ar: 'رقم المعاملات' },
  'admin.total_orders': { fr: 'Commandes', ar: 'الطلبات' },
  'admin.total_products': { fr: 'Produits', ar: 'المنتجات' },
  'admin.low_stock': { fr: 'Stock faible', ar: 'مخزون منخفض' },
  'admin.add_product': { fr: 'Ajouter un produit', ar: 'إضافة منتج' },
  'admin.edit_product': { fr: 'Modifier le produit', ar: 'تعديل المنتج' },
  'admin.name_fr': { fr: 'Nom (FR)', ar: 'الاسم (FR)' },
  'admin.name_ar': { fr: 'Nom (AR)', ar: 'الاسم (AR)' },
  'admin.desc_fr': { fr: 'Description (FR)', ar: 'الوصف (FR)' },
  'admin.desc_ar': { fr: 'Description (AR)', ar: 'الوصف (AR)' },
  'admin.price': { fr: 'Prix (DA)', ar: 'الثمن (دج)' },
  'admin.stock': { fr: 'Stock', ar: 'المخزون' },
  'admin.sizes': { fr: 'Tailles', ar: 'المقاسات' },
  'admin.sizes_hint': { fr: 'Sépare les tailles par des virgules, ex. : S,M,L,XL ou 40,41,42.', ar: 'افصل المقاسات بفواصل، مثال: S,M,L,XL أو 40,41,42.' },
  'admin.category': { fr: 'Catégorie', ar: 'الفئة' },
  'admin.image': { fr: 'Image', ar: 'الصورة' },
  'admin.active': { fr: 'Actif', ar: 'نشط' },
  'admin.save': { fr: 'Enregistrer', ar: 'حفظ' },
  'admin.cancel': { fr: 'Annuler', ar: 'إلغاء' },
  'admin.edit': { fr: 'Modifier', ar: 'تعديل' },
  'admin.delete': { fr: 'Supprimer', ar: 'حذف' },
  'admin.actions': { fr: 'Actions', ar: 'إجراءات' },
  'admin.updated_status': { fr: 'Statut mis à jour.', ar: 'تم تحديث الحالة.' },
  'admin.customer': { fr: 'Client', ar: 'العميل' },
  'admin.slug': { fr: 'Slug (URL)', ar: 'الرابط (Slug)' },
  'admin.add_category': { fr: 'Ajouter une catégorie', ar: 'إضافة فئة' },
  'admin.cat_has_products': { fr: 'Suppression impossible : cette catégorie contient des produits. Déplacez-les ou supprimez-les d\'abord.', ar: 'لا يمكن الحذف: هذه الفئة تحتوي على منتجات. انقلها أو احذفها أولاً.' },
  'admin.forbidden': { fr: 'Accès réservé à l\'administrateur.', ar: 'الوصول مخصص للمدير فقط.' },
  'admin.cant_order': { fr: 'Le compte administrateur ne peut pas passer de commandes.', ar: 'حساب المدير لا يمكنه إجراء طلبات.' },
  'admin.back_to_store': { fr: 'Retour à la boutique', ar: 'العودة إلى المتجر' },
  'admin.upload_invalid': { fr: 'Image invalide (jpg/png/webp uniquement).', ar: 'صورة غير صالحة (jpg/png/webp فقط).' },
  'admin.upload_error': { fr: 'Erreur d\'upload (fichier trop volumineux ?).', ar: 'خطأ في الرفع (الملف كبير جداً؟).' },
  'admin.invalid_data': { fr: 'Données invalides. Vérifiez le prix et le stock.', ar: 'بيانات غير صالحة. تحقق من الثمن والمخزون.' },

  // Accueil (vitrine)
  'home.hero_cta': { fr: 'Voir les produits', ar: 'تصفّح المنتجات' },
  'home.shop_by_category': { fr: 'Acheter par catégorie', ar: 'تسوّق حسب الفئة' },
  'home.top_sales': { fr: 'Top ventes', ar: 'الأكثر مبيعاً' },
  'home.new_arrivals': { fr: 'Nouveautés', ar: 'وصل حديثاً' },
  'home.see_all': { fr: 'Voir tout', ar: 'عرض الكل' },
  'home.hurry': { fr: 'Ça part vite', ar: 'ينفد بسرعة' },
  'home.r1_t': { fr: 'Satisfait ou remboursé', ar: 'راضٍ أو استرد أموالك' },
  'home.r1_d': { fr: '14 jours pour changer d\'avis', ar: '14 يوماً لتغيير رأيك' },
  'home.r2_t': { fr: 'Livraison rapide', ar: 'توصيل سريع' },
  'home.r2_d': { fr: 'Partout en Algérie', ar: 'في جميع أنحاء الجزائر' },
  'home.r3_t': { fr: 'Livraison à domicile', ar: 'توصيل إلى المنزل' },
  'home.r3_d': { fr: 'Tarif unique 600 DA', ar: 'سعر موحد 600 دج' },
  'home.r4_t': { fr: 'Paiements sécurisés', ar: 'مدفوعات آمنة' },
  'home.r4_d': { fr: 'Carte, PayPal ou à la livraison', ar: 'بطاقة، باي بال أو عند الاستلام' },
  'home.news_title': { fr: 'Restez connecté', ar: 'ابقَ على اتصال' },
  'home.news_sub': { fr: 'Recevez nos nouveautés et offres en avant-première.', ar: 'استقبل جديدنا وعروضنا قبل الجميع.' },
  'home.news_placeholder': { fr: 'Votre adresse e-mail', ar: 'بريدك الإلكتروني' },
  'home.news_btn': { fr: 'S\'abonner', ar: 'اشترك' },
  'home.news_success': { fr: 'Merci pour votre inscription !', ar: 'شكراً لاشتراكك!' },
  'home.news_invalid': { fr: 'Adresse e-mail invalide.', ar: 'بريد إلكتروني غير صالح.' },

  // Footer
  'footer.payments': { fr: 'Paiements acceptés', ar: 'طرق الدفع' },
  'footer.shop': { fr: 'Boutique', ar: 'المتجر' },
  'footer.rights': { fr: 'Tous droits réservés.', ar: 'جميع الحقوق محفوظة.' },

  // Divers
  'lang.switch': { fr: 'العربية', ar: 'Français' },
  'common.back': { fr: 'Retour', ar: 'رجوع' },
  'common.view': { fr: 'Voir', ar: 'عرض' },
  'common.save': { fr: 'Enregistrer', ar: 'حفظ' },
  'common.details': { fr: 'Détails', ar: 'التفاصيل' },

  // Flash / messages
  'cart.added': { fr: 'Produit ajouté au panier.', ar: 'تمت إضافة المنتج إلى السلة.' },
  'auth.register_success': { fr: 'Compte créé. Bienvenue !', ar: 'تم إنشاء الحساب. مرحباً بك!' },
  'order.cancelled': { fr: 'Paiement annulé.', ar: 'تم إلغاء الدفع.' },
  'order.pay_again': { fr: 'Réessayer le paiement', ar: 'إعادة محاولة الدفع' },
};

function makeT(lang) {
  const l = lang === 'ar' ? 'ar' : 'fr';
  return (key) => {
    const entry = strings[key];
    if (!entry) return key;
    return entry[l] || entry.fr || key;
  };
}

module.exports = { strings, makeT };
