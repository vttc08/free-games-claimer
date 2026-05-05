export const EPIC_FREE_GAMES_URL = 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions';

const activePromotions = (offer, now) => {
  const windows = offer?.promotions?.promotionalOffers || [];
  return windows
    .flatMap(group => group.promotionalOffers || [])
    .filter(window => {
      const start = new Date(window.startDate).getTime();
      const end = new Date(window.endDate).getTime();
      return Number.isFinite(start) && Number.isFinite(end) && start <= now.getTime() && now.getTime() < end;
    });
};

const buildOfferUrl = offer => {
  const pageSlug = offer.offerMappings?.[0]?.pageSlug
    || offer.catalogNs?.mappings?.[0]?.pageSlug
    || offer.productSlug
    || offer.urlSlug;

  if (!pageSlug) {
    return null;
  }

  return `https://store.epicgames.com/en-US/p/${pageSlug.replace(/\/home$/, '')}`;
};

export const normalizeEpicFreeGame = (offer, now = new Date()) => {
  const offers = activePromotions(offer, now);
  const discountPrice = offer?.price?.totalPrice?.discountPrice;
  if (!offers.length || discountPrice !== 0 || offer?.offerType !== 'BASE_GAME' || offer?.isCodeRedemptionOnly) {
    return null;
  }

  return {
    id: offer.id,
    namespace: offer.namespace,
    title: offer.title,
    url: buildOfferUrl(offer),
    promotions: offers,
    items: Array.isArray(offer.items) ? offer.items : [],
  };
};

export const extractCurrentFreeGames = (payload, now = new Date()) => {
  const offers = payload?.data?.Catalog?.searchStore?.elements || [];
  return offers
    .map(offer => normalizeEpicFreeGame(offer, now))
    .filter(Boolean);
};

export const compareEpicOwnership = (offers, assets) => {
  const ownedCatalogIds = new Set(
    assets
      .filter(asset => asset?.catalogItemId && asset?.namespace)
      .map(asset => `${asset.namespace}:${asset.catalogItemId}`),
  );

  return offers.map(offer => {
    const ids = new Set([`${offer.namespace}:${offer.id}`]);
    for (const item of offer.items || []) {
      if (item?.namespace && item?.id) {
        ids.add(`${item.namespace}:${item.id}`);
      }
    }

    const owned = [...ids].some(id => ownedCatalogIds.has(id));
    return {
      ...offer,
      owned,
      status: owned ? 'in library' : 'not in library',
    };
  });
};

export const fetchEpicFreeGames = async (fetchImpl = fetch) => {
  const response = await fetchImpl(EPIC_FREE_GAMES_URL, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Epic free games request failed with ${response.status} ${response.statusText}.`);
  }

  return extractCurrentFreeGames(await response.json());
};
