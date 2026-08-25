import { useWebsite } from "../context/WebsiteContext";
import { useMenu } from "../hooks/useMenu";
import { useCart } from "../context/CartContext";
import Hero from "../components/sections/Hero";
import ScrollFeast from "../components/ScrollFeast";
import BrandEthos from "../components/sections/BrandEthos";
import FeaturedMenu from "../components/sections/FeaturedMenu";
import Story from "../components/sections/Story";
import EditorialGallery from "../components/sections/EditorialGallery";
import OrderFinale from "../components/sections/OrderFinale";
import { defaultModifiers } from "../components/common";
import "../home.css";

export default function HomePage() {
  const { settings, restaurantName, openingHours, getSetting } = useWebsite();
  const { categories, menuItems, loading } = useMenu();
  const { addToCart } = useCart();

  const tagline = getSetting("restaurant_tagline", "Delicious food, delivered with love");
  const description = getSetting("restaurant_description", "");
  const heroImage = getSetting("hero_image", "/images/about-restaurant.png");
  const heroVideo = getSetting("hero_video", "");
  const aboutImage = getSetting("about_image", "");
  const aboutImgSrc = aboutImage || "/images/about-restaurant.png";
  const aboutContent =
    getSetting("about_content", "").trim() ||
    "We are a family-run kitchen serving fresh, flavourful food made from quality ingredients.";

  const totalItems = menuItems.length;
  const daysOpen = openingHours ? Object.keys(openingHours).length : 7;
  const takeawayEnabled = settings.takeaway_enabled !== false;
  const deliveryEnabled = settings.delivery_enabled !== false;
  const orderNote = [takeawayEnabled && "Takeaway", deliveryEnabled && "Delivery"]
    .filter(Boolean)
    .join(" · ");

  const popularItems = menuItems.slice(0, 8);

  const handleQuickAdd = (item, modifiers) => {
    addToCart(item, 1, modifiers && modifiers.length ? modifiers : defaultModifiers(item), "");
  };

  return (
    <div className="home">
      <Hero
        restaurantName={restaurantName}
        tagline={tagline}
        description={description}
        heroImage={heroImage}
        heroVideo={heroVideo}
        openingHours={openingHours}
        orderNote={orderNote}
      />

      <ScrollFeast />

      <BrandEthos
        description={description}
        totalItems={totalItems}
        daysOpen={daysOpen}
        orderNote={orderNote}
      />

      <FeaturedMenu
        categories={categories}
        popularItems={popularItems}
        loading={loading}
        onAdd={handleQuickAdd}
      />

      <Story
        restaurantName={restaurantName}
        aboutContent={aboutContent}
        aboutImgSrc={aboutImgSrc}
        totalItems={totalItems}
        daysOpen={daysOpen}
        orderNote={orderNote}
      />

      <EditorialGallery />

      <OrderFinale />
    </div>
  );
}
