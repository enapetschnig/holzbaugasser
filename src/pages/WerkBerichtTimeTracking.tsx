import MatrixBerichtForm from "@/components/MatrixBerichtForm";

export default function WerkBerichtTimeTracking() {
  return (
    <MatrixBerichtForm
      berichtTyp="werk"
      pageTitle="Werk-Bericht"
      taetigkeitPrefix="Werk"
    />
  );
}
