import { useLocalSearchParams } from 'expo-router';
import { ItemForm } from '../../../components/ItemForm';

export default function NewItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ItemForm collectionId={Number(id)} askPhoto />;
}
