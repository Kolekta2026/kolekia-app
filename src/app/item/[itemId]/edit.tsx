import { useLocalSearchParams } from 'expo-router';
import { ItemForm } from '../../../components/ItemForm';

export default function EditItemScreen() {
  const { itemId, ai } = useLocalSearchParams<{ itemId: string; ai?: string }>();
  return <ItemForm itemId={Number(itemId)} autoAi={ai === '1'} />;
}
