import { supabase } from '../config/supabase';
import { log } from '../utils/logger';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { withServiceTimeout } from './serviceTimeout';

export const momentsService = {
  async uploadMoment(partnershipId, userId, imageUri, caption = '') {
    log('[MOMENTS SERVICE] uploadMoment called');
    
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: 'base64',
    });

    const rawExt = (imageUri.split('.').pop() || 'jpg').split(/[?#]/)[0].toLowerCase();
    const MIME_MAP = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', heic: 'heic' };
    const fileExt = MIME_MAP[rawExt] ? rawExt : 'jpg';
    const mimeType = `image/${MIME_MAP[fileExt] || 'jpeg'}`;
    const fileName = `${userId}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('moments')
      .upload(fileName, decode(base64), {
        contentType: mimeType,
      });

    if (uploadError) {
      log('[MOMENTS SERVICE] Upload error:', uploadError);
      throw uploadError;
    }

    const { data: urlData } = supabase.storage
      .from('moments')
      .getPublicUrl(fileName);

    const { data, error } = await supabase
      .from('moments')
      .insert({
        partnership_id: partnershipId,
        user_id: userId,
        image_url: urlData.publicUrl,
        caption,
      })
      .select()
      .single();

    if (error) {
      log('[MOMENTS SERVICE] Insert error:', error);
      throw error;
    }
    
    log('[MOMENTS SERVICE] Moment created:', data.id);
    return data;
  },

  async getMoments(partnershipId, limit = 50) {
    log('[MOMENTS SERVICE] getMoments called');
    
    const { data, error } = await withServiceTimeout(
      supabase
        .from('moments')
        .select('*')
        .eq('partnership_id', partnershipId)
        .order('created_at', { ascending: false })
        .limit(limit),
      'moments.getMoments'
    );

    if (error) {
      log('[MOMENTS SERVICE] Fetch error:', error);
      throw error;
    }
    
    log('[MOMENTS SERVICE] Fetched:', data?.length, 'moments');
    return data;
  },

  async deleteMoment(momentId, imageUrl) {
    log('[MOMENTS SERVICE] deleteMoment called:', momentId);

    // Delete from database first
    const { error: dbError } = await supabase
      .from('moments')
      .delete()
      .eq('id', momentId);

    if (dbError) {
      log('[MOMENTS SERVICE] DELETE ERROR:', dbError);
      throw new Error('Delete failed: ' + dbError.message);
    }

    log('[MOMENTS SERVICE] Database delete successful');

    // Try to delete from storage (don't fail if this doesn't work)
    try {
      const urlParts = imageUrl.split('?')[0].split('/');
      const filePath = urlParts.slice(-2).join('/');
      await supabase.storage.from('moments').remove([filePath]);
      log('[MOMENTS SERVICE] Storage delete successful');
    } catch (storageErr) {
      log('[MOMENTS SERVICE] Storage delete failed (non-critical):', storageErr);
    }
  },

  subscribeToMoments(partnershipId, callback) {
    log('[MOMENTS SERVICE] Subscribing');
    return supabase
      .channel(`moments:${partnershipId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'moments',
        filter: `partnership_id=eq.${partnershipId}`,
      }, callback)
      .subscribe();
  },
};
