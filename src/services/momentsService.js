import { supabase } from '../config/supabase';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

export const momentsService = {
  async uploadMoment(partnershipId, userId, imageUri, caption = '') {
    console.log('[MOMENTS SERVICE] uploadMoment called');
    
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: 'base64',
    });

    const fileExt = imageUri.split('.').pop() || 'jpg';
    const fileName = `${userId}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('moments')
      .upload(fileName, decode(base64), {
        contentType: `image/${fileExt}`,
      });

    if (uploadError) {
      console.log('[MOMENTS SERVICE] Upload error:', uploadError);
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
      console.log('[MOMENTS SERVICE] Insert error:', error);
      throw error;
    }
    
    console.log('[MOMENTS SERVICE] Moment created:', data.id);
    return data;
  },

  async getMoments(partnershipId, limit = 50) {
    console.log('[MOMENTS SERVICE] getMoments called');
    
    const { data, error } = await supabase
      .from('moments')
      .select('*')
      .eq('partnership_id', partnershipId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.log('[MOMENTS SERVICE] Fetch error:', error);
      throw error;
    }
    
    console.log('[MOMENTS SERVICE] Fetched:', data?.length, 'moments');
    return data;
  },

  async deleteMoment(momentId, imageUrl) {
    console.log('[MOMENTS SERVICE] deleteMoment called:', momentId);

    // Delete from database first
    const { error: dbError } = await supabase
      .from('moments')
      .delete()
      .eq('id', momentId);

    if (dbError) {
      console.log('[MOMENTS SERVICE] DELETE ERROR:', dbError);
      throw new Error('Delete failed: ' + dbError.message);
    }

    console.log('[MOMENTS SERVICE] Database delete successful');

    // Try to delete from storage (don't fail if this doesn't work)
    try {
      const urlParts = imageUrl.split('/');
      const filePath = urlParts.slice(-2).join('/');
      await supabase.storage.from('moments').remove([filePath]);
      console.log('[MOMENTS SERVICE] Storage delete successful');
    } catch (storageErr) {
      console.log('[MOMENTS SERVICE] Storage delete failed (non-critical):', storageErr);
    }
  },

  subscribeToMoments(partnershipId, callback) {
    console.log('[MOMENTS SERVICE] Subscribing');
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
