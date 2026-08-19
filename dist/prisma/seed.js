import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const categories = ['Skincare', 'Makeup', 'Hair Care', 'Body Care', 'Fragrance', 'Beauty Tools', 'Wellness'];
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
async function main() {
    for (const [sortOrder, name] of categories.entries())
        await prisma.category.upsert({ where: { slug: slug(name) }, update: {}, create: { name, slug: slug(name), sortOrder, description: `Curated ${name.toLowerCase()} essentials.` } });
    const brand = await prisma.brand.upsert({ where: { slug: 'myokin-edit' }, update: {}, create: { name: 'MYOKIN Edit', slug: 'myokin-edit', description: 'The MYOKIN signature edit.' } });
    await prisma.brand.upsert({ where: { slug: 'amani-botanics' }, update: {}, create: { name: 'Amani Botanics', slug: 'amani-botanics' } });
    const skincare = await prisma.category.findUniqueOrThrow({ where: { slug: 'skincare' } });
    const products = [
        { name: 'Glass Skin Renewal Serum', sku: 'MYK-SKN-001', price: 2850, compareAtPrice: 3200, stockQuantity: 24, isFeatured: true, isBestSeller: true, image: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=900&q=85' },
        { name: 'Cloud Cream Moisturiser', sku: 'MYK-SKN-002', price: 2400, stockQuantity: 18, isFeatured: true, isNewArrival: true, image: 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=900&q=85' },
    ];
    for (const item of products) {
        const { image, ...data } = item;
        await prisma.product.upsert({ where: { sku: item.sku }, update: {}, create: { ...data, slug: slug(item.name), description: `${item.name} is a considered daily ritual for balanced, radiant skin.`, shortDescription: 'A high-performing essential for your daily beauty ritual.', categoryId: skincare.id, brandId: brand.id, status: 'ACTIVE', skinType: ['All skin types'], hairType: [], concerns: ['Dullness'], images: { create: { url: image, altText: item.name } } } });
    }
    for (const zone of [{ name: 'Nairobi Metro', county: 'Nairobi', fee: 250, estimatedDays: '1–2 business days' }, { name: 'Kiambu & Ruiru', county: 'Kiambu', fee: 300, estimatedDays: '1–2 business days' }, { name: 'Nationwide', county: 'Other', fee: 450, estimatedDays: '2–4 business days' }])
        await prisma.deliveryZone.upsert({ where: { id: slug(zone.name) }, update: zone, create: { id: slug(zone.name), ...zone, freeDeliveryThreshold: 5000 } });
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (email && password)
        await prisma.user.upsert({ where: { email }, update: { role: 'SUPER_ADMIN' }, create: { firstName: 'Store', lastName: 'Administrator', email, passwordHash: await bcrypt.hash(password, 12), role: 'SUPER_ADMIN', emailVerified: true } });
    await prisma.storeSetting.upsert({ where: { id: 'store' }, update: {}, create: { id: 'store', contactEmail: 'hello@myokin.co.ke', currency: 'KES', freeDeliveryThreshold: 5000, defaultDeliveryFee: 350 } });
}
main().finally(() => prisma.$disconnect());
